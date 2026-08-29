import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { startSocketServer, stopSocketServer } from './socketServer';
import { closeRedisConnection } from '../queues/connection';
import { getRealtimeEmitter, resetRealtimeEmitter } from '../realtime/events';
import type { AuthContext } from '../types/express';

// This suite exercises the real Socket.IO server + a real socket.io-client
// over a real TCP port — only the two DB-touching dependencies (auth
// resolution, conversation lookup) are mocked, so it runs fully offline
// without needing MongoDB, while still proving the actual auth middleware,
// room-join authorization, tenant isolation, and typing-relay logic.

jest.mock('../modules/auth/authContext.service', () => ({
  resolveAuthContextFromToken: jest.fn(),
}));
jest.mock('../modules/conversations/conversation.repository', () => ({
  findConversationByIdAndTenant: jest.fn(),
  markConversationRead: jest.fn(),
}));

import { resolveAuthContextFromToken } from '../modules/auth/authContext.service';
import { findConversationByIdAndTenant, markConversationRead } from '../modules/conversations/conversation.repository';

const mockResolveAuth = resolveAuthContextFromToken as jest.MockedFunction<typeof resolveAuthContextFromToken>;
const mockFindConversation = findConversationByIdAndTenant as jest.MockedFunction<typeof findConversationByIdAndTenant>;
const mockMarkRead = markConversationRead as jest.MockedFunction<typeof markConversationRead>;

const AUTH_BY_TOKEN: Record<string, AuthContext> = {
  'tenant-a-user-1': { userId: 'user-a1', tenantId: 'tenant-a', role: 'SUB_USER', permissions: ['CHAT_READ'] },
  'tenant-a-user-2': { userId: 'user-a2', tenantId: 'tenant-a', role: 'SUB_USER', permissions: ['CHAT_READ'] },
  'tenant-b-user-1': { userId: 'user-b1', tenantId: 'tenant-b', role: 'SUB_USER', permissions: ['CHAT_READ'] },
};

function fakeConversationDoc(tenantId: string, overrides: Partial<{ unreadCount: number }> = {}) {
  return {
    _id: 'conv-1',
    tenantId,
    contactId: 'contact-1',
    whatsappPhoneNumberId: 'wpn-1',
    unreadCount: 3,
    pinned: false,
    lastMessageAt: new Date('2026-01-01T00:00:00Z'),
    lastMessagePreview: 'hi',
    ...overrides,
  };
}

let httpServer: ReturnType<typeof createServer>;
let port: number;
let baseUrl: string;

beforeAll(async () => {
  mockResolveAuth.mockImplementation(async (token: string) => {
    const ctx = AUTH_BY_TOKEN[token];
    if (!ctx) throw new Error('INVALID_TOKEN');
    return ctx;
  });
  mockFindConversation.mockImplementation(async (id: string, tenantId: string) => {
    if (id === 'conv-1' && tenantId === 'tenant-a') return fakeConversationDoc(tenantId) as never;
    return null;
  });
  mockMarkRead.mockImplementation(async (id: string, tenantId: string) => {
    if (id === 'conv-1' && tenantId === 'tenant-a') return fakeConversationDoc(tenantId, { unreadCount: 0 }) as never;
    return null;
  });

  httpServer = createServer();
  startSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await stopSocketServer();
  // stopSocketServer() only closes the adapter's own duplicated
  // connections; the shared singleton (env.REDIS_URL was set for this run,
  // via `getRedisConnection()`) is otherwise only closed by server.ts's
  // process-shutdown path, which this test never runs.
  await closeRedisConnection();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  resetRealtimeEmitter();
});

function connect(token: string | undefined): ClientSocket {
  return ioClient(baseUrl, {
    auth: token !== undefined ? { token } : {},
    reconnection: false,
    forceNew: true,
    transports: ['websocket'],
  });
}

function waitFor<T = unknown>(socket: ClientSocket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('Socket.IO gateway', () => {
  it('rejects a connection with no token', async () => {
    const client = connect(undefined);
    const err = await waitFor<Error>(client, 'connect_error');
    expect(err.message).toBe('AUTH_REQUIRED');
    client.close();
  });

  it('rejects a connection with an unrecognized token', async () => {
    const client = connect('not-a-real-token');
    const err = await waitFor<Error>(client, 'connect_error');
    expect(err.message).toBe('INVALID_TOKEN');
    client.close();
  });

  it('accepts a connection with a valid token', async () => {
    const client = connect('tenant-a-user-1');
    await waitFor(client, 'connect');
    expect(client.connected).toBe(true);
    client.close();
  });

  it('auto-joins the tenant room, so a tenant-wide emit reaches the client', async () => {
    const client = connect('tenant-a-user-1');
    await waitFor(client, 'connect');

    const received = waitFor(client, 'conversation:updated');
    getRealtimeEmitter().emitConversationUpdated('tenant-a', {
      id: 'conv-1',
      contactId: 'contact-1',
      whatsappPhoneNumberId: 'wpn-1',
      unreadCount: 0,
      manuallyUnread: false,
      pinned: false,
    });
    await expect(received).resolves.toMatchObject({ id: 'conv-1' });

    client.close();
  });

  it('does NOT deliver another tenant\'s broadcast to this client', async () => {
    const client = connect('tenant-a-user-1');
    await waitFor(client, 'connect');

    let receivedWrongTenant = false;
    client.on('conversation:updated', () => {
      receivedWrongTenant = true;
    });

    getRealtimeEmitter().emitConversationUpdated('tenant-b', {
      id: 'conv-999',
      contactId: 'contact-x',
      whatsappPhoneNumberId: 'wpn-x',
      unreadCount: 0,
      manuallyUnread: false,
      pinned: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(receivedWrongTenant).toBe(false);

    client.close();
  });

  it('conversation:join succeeds only when the conversation belongs to the socket\'s own tenant', async () => {
    const tenantAClient = connect('tenant-a-user-1');
    await waitFor(tenantAClient, 'connect');
    const okAck = await new Promise((resolve) => {
      tenantAClient.emit('conversation:join', { conversationId: 'conv-1' }, resolve);
    });
    expect(okAck).toEqual({ success: true });
    tenantAClient.close();

    const tenantBClient = connect('tenant-b-user-1');
    await waitFor(tenantBClient, 'connect');
    const deniedAck = await new Promise((resolve) => {
      tenantBClient.emit('conversation:join', { conversationId: 'conv-1' }, resolve);
    });
    expect(deniedAck).toMatchObject({ success: false });
    tenantBClient.close();
  });

  it('conversation:read marks read and broadcasts conversation:updated to the tenant room', async () => {
    const client = connect('tenant-a-user-1');
    await waitFor(client, 'connect');

    const updated = waitFor(client, 'conversation:updated');
    const ack = await new Promise((resolve) => {
      client.emit('conversation:read', { conversationId: 'conv-1' }, resolve);
    });
    expect(ack).toEqual({ success: true });
    await expect(updated).resolves.toMatchObject({ id: 'conv-1', unreadCount: 0 });

    client.close();
  });

  it('typing:start is only relayed to sockets that joined that conversation room', async () => {
    const joined = connect('tenant-a-user-1');
    const notJoined = connect('tenant-a-user-2');
    await Promise.all([waitFor(joined, 'connect'), waitFor(notJoined, 'connect')]);

    await new Promise((resolve) => joined.emit('conversation:join', { conversationId: 'conv-1' }, resolve));

    let notJoinedReceived = false;
    notJoined.on('typing:start', () => {
      notJoinedReceived = true;
    });

    // A second, joined socket to actually receive the relay (the emitting
    // socket itself never gets its own broadcast back — that's socket.to()'s
    // documented behavior, not a bug).
    const alsoJoined = connect('tenant-a-user-1');
    await waitFor(alsoJoined, 'connect');
    await new Promise((resolve) => alsoJoined.emit('conversation:join', { conversationId: 'conv-1' }, resolve));

    const relay = waitFor(alsoJoined, 'typing:start');
    joined.emit('typing:start', { conversationId: 'conv-1' });
    await expect(relay).resolves.toMatchObject({ conversationId: 'conv-1', userId: 'user-a1' });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(notJoinedReceived).toBe(false);

    joined.close();
    notJoined.close();
    alsoJoined.close();
  });
});
