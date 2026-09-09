import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { isRedisConfigured, getRedisConnection } from '../queues/connection';
import { resolveAuthContextFromToken } from '../modules/auth/authContext.service';
import { resolveGuestContextFromToken } from '../modules/guest/guest.service';
import { tenantRoom, userRoom, phoneNumberRoom, conversationRoom, agentsRoom, guestPresenceRoom } from './rooms';
import { broadcastAgentPresence, countOnlineAgents } from './presence';
import { visibleWhatsAppPhoneNumberId } from '../modules/conversations/conversation.access';
import { registerConversationHandlers } from './events/conversation';
import { registerTypingHandlers } from './events/typing';
import { registerGuestCallHandlers, registerAgentWebCallHandlers } from './events/webCall';
import { hasTurnConfigured } from '../modules/calls/webCall.service';
import { registerGuestTypingHandlers } from './events/guestTyping';
import { createSocketRealtimeEmitter } from './realtimeEmitterImpl';
import { setRealtimeEmitter } from '../realtime/events';
import type { AppServer, AppSocket } from './types';

const REVALIDATE_INTERVAL_MS = 5 * 60 * 1000; // must be <= JWT_ACCESS_TTL for expiry to be caught promptly

let io: AppServer | null = null;
// The adapter's own duplicated connections — separate from the shared
// connection getRedisConnection() returns, so they must be closed
// independently in stopSocketServer(), or a test/process restart leaks
// live TCP sockets to Redis indefinitely (confirmed: without this, Jest
// hangs after the suite finishes rather than exiting).
let adapterPubClient: Redis | null = null;
let adapterSubClient: Redis | null = null;

export function getIO(): AppServer {
  if (!io) {
    throw new Error('Socket.IO server has not been started yet');
  }
  return io;
}

/**
 * Attaches Socket.IO to the same HTTP server the REST API listens on
 * (spec §22): JWT-authenticated handshake, tenant:{tenantId} and
 * user:{userId} auto-joined on connect, Redis adapter for horizontal
 * scaling when REDIS_URL is configured, and periodic re-validation so a
 * mid-session account disable or subscription expiry disconnects the
 * socket — never trust a token's validity for longer than its own TTL.
 */
export function startSocketServer(httpServer: HttpServer): AppServer {
  io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    // socket.io-client reconnects automatically with these defaults; the
    // Android app doesn't need extra client-side reconnect logic beyond
    // handling the 'disconnect'/'connect' events to refresh UI state.
  });

  if (isRedisConfigured()) {
    adapterPubClient = getRedisConnection().duplicate();
    adapterSubClient = getRedisConnection().duplicate();
    io.adapter(createAdapter(adapterPubClient, adapterSubClient));
    logger.info('Socket.IO using the Redis adapter (horizontal scaling enabled)');
  } else {
    logger.warn('REDIS_URL not configured — Socket.IO running single-instance only, no cross-instance fan-out');
  }

  // Said out loud at boot because the symptom is otherwise a mystery: with
  // STUN alone, a browser and a phone on mobile networks usually cannot
  // reach each other, so calls ring, appear to be answered, and then sit
  // silent until they time out. Nothing in the logs would point at the
  // missing relay.
  if (!hasTurnConfigured()) {
    logger.warn(
      'TURN_URLS not configured — web calls between the chat window and the agent app will fail ' +
        'on most mobile networks. STUN alone cannot traverse carrier NAT.',
    );
  }

  io.use(async (socket, next) => {
    try {
      // A customer's web-chat link, checked first and never mixed with the
      // agent path: the two carry different credentials, stand for
      // different things, and must not be able to fall through into each
      // other's branch on a malformed handshake.
      const guestToken = socket.handshake.auth?.guestToken as string | undefined;
      if (guestToken) {
        socket.data.guest = await resolveGuestContextFromToken(guestToken);
        next();
        return;
      }

      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) {
        next(new Error('AUTH_REQUIRED'));
        return;
      }
      socket.data.auth = await resolveAuthContextFromToken(token);
      next();
    } catch (err) {
      next(new Error(err instanceof Error ? err.message : 'INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket: AppSocket) => {
    const { guest } = socket.data;

    // A customer joins exactly one room: the conversation their link
    // stands for. Never the tenant or number rooms — those carry every
    // chat the workspace can see, and a socket in one of them would
    // receive other customers' messages. No conversation:join handler is
    // registered either, so there is no path by which a guest socket can
    // ask for a second room at all.
    if (guest) {
      void socket.join(conversationRoom(guest.conversationId));
      // A room carrying nothing but availability. Guests are never in the
      // agent or tenant rooms, which hold the whole workspace's messages.
      void socket.join(guestPresenceRoom(guest.tenantId));
      logger.debug({ conversationId: guest.conversationId, socketId: socket.id }, 'Guest socket connected');

      registerGuestCallHandlers(io as AppServer, socket, guest);
      registerGuestTypingHandlers(socket, guest);

      // Answer the question the page opens with, rather than leaving it
      // showing "offline" until an agent happens to connect or leave.
      void countOnlineAgents(io as AppServer, guest.tenantId).then((count) => {
        socket.emit('agent:presence', { online: count > 0 });
      });

      // The same reasoning as the agent re-validation below: a link can be
      // revoked or expire while the page is still open, and a long-lived
      // socket must not outlive what an HTTP request with the same token
      // would be allowed to do.
      const revalidateGuest = setInterval(() => {
        const token = socket.handshake.auth?.guestToken as string | undefined;
        if (!token) {
          socket.disconnect(true);
          return;
        }
        resolveGuestContextFromToken(token).catch(() => {
          logger.debug({ socketId: socket.id }, 'Guest socket failed re-validation — disconnecting');
          socket.disconnect(true);
        });
      }, REVALIDATE_INTERVAL_MS);

      socket.on('disconnect', () => clearInterval(revalidateGuest));
      return;
    }

    const auth = socket.data.auth;
    if (!auth) {
      // Unreachable through the middleware above, which sets exactly one
      // of the two. Closing rather than trusting that is what keeps it
      // unreachable if a future branch forgets.
      socket.disconnect(true);
      return;
    }

    // Exactly one visibility room, never both. The tenant room is where
    // chat events are broadcast to everyone who may see the whole
    // workspace; a user scoped to one number joins that number's room
    // instead, so a colleague's message is never delivered to their
    // device at all — not delivered-then-hidden.
    const scope = visibleWhatsAppPhoneNumberId(auth);
    void socket.join(scope ? phoneNumberRoom(scope) : tenantRoom(auth.tenantId));
    void socket.join(userRoom(auth.userId));
    // One room every agent joins, whichever visibility room they landed
    // in, so "is anyone from this workspace here" is a single lookup.
    void socket.join(agentsRoom(auth.tenantId));
    void broadcastAgentPresence(io as AppServer, auth.tenantId);
    logger.debug({ userId: auth.userId, tenantId: auth.tenantId, socketId: socket.id }, 'Socket connected');

    registerConversationHandlers(io as AppServer, socket, auth);
    registerTypingHandlers(socket, auth);
    registerAgentWebCallHandlers(io as AppServer, socket, auth);

    // Re-runs the exact same check requireAuth uses on every HTTP request
    // (account status, subscription window, and — because it re-verifies
    // the JWT — the token's own expiry). A long-lived socket connection
    // must not outlive what an HTTP request with the same token would be
    // allowed to do.
    const revalidate = setInterval(() => {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) {
        socket.disconnect(true);
        return;
      }
      resolveAuthContextFromToken(token).catch(() => {
        logger.debug({ socketId: socket.id }, 'Socket failed re-validation — disconnecting');
        socket.disconnect(true);
      });
    }, REVALIDATE_INTERVAL_MS);

    socket.on('disconnect', (reason) => {
      clearInterval(revalidate);
      // After the socket has left its rooms, so the count reflects who is
      // actually still here rather than including the one just lost.
      void broadcastAgentPresence(io as AppServer, auth.tenantId);
      logger.debug({ socketId: socket.id, reason }, 'Socket disconnected');
    });
  });

  setRealtimeEmitter(createSocketRealtimeEmitter(io));
  return io;
}

export async function stopSocketServer(): Promise<void> {
  if (io) {
    await new Promise<void>((resolve) => {
      io?.close(() => resolve());
    });
    io = null;
  }
  await Promise.all([adapterPubClient?.quit(), adapterSubClient?.quit()]);
  adapterPubClient = null;
  adapterSubClient = null;
}
