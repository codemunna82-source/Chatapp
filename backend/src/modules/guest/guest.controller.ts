import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { getGuestContext } from '../../middleware/guestAuth.middleware';
import { ApiError } from '../../lib/ApiError';
import { buildIceServers, hasTurnConfigured } from '../calls/webCall.service';
import { getGuestMediaBytes, storeGuestMedia } from './guestMedia.service';
import * as guestService from './guest.service';

/* ------------------------------------------------------------------ *
 * Customer-facing — authenticated by the web-chat link, not a login.  *
 * ------------------------------------------------------------------ */

export const getGuestSessionHandler = asyncHandler(async (req: Request, res: Response) => {
  const guest = getGuestContext(req);
  res.status(200).json({ success: true, data: await guestService.getGuestSessionView(guest) });
});

export const listGuestMessagesHandler = asyncHandler(async (req: Request, res: Response) => {
  const guest = getGuestContext(req);
  const { cursor, limit } = req.query as { cursor?: string; limit?: number };
  const result = await guestService.listGuestMessages(guest, { cursor, limit });
  res.status(200).json({ success: true, data: result.items, meta: { nextCursor: result.nextCursor } });
});

export const postGuestMessageHandler = asyncHandler(async (req: Request, res: Response) => {
  const guest = getGuestContext(req);
  const { text, replyToMessageId } = req.body as { text: string; replyToMessageId?: string };
  res.status(201).json({ success: true, data: await guestService.postGuestMessage(guest, text, replyToMessageId) });
});

/**
 * The ICE configuration for a call from this window. Served rather than
 * built into the page so the TURN credentials live in one config the
 * agent app reads too, and requires a valid link like every other guest
 * route — TURN credentials are not something to hand out unauthenticated.
 */
export const getGuestIceHandler = asyncHandler(async (req: Request, res: Response) => {
  getGuestContext(req);
  // hasTurn rides along so a call that never connects can say why. Without
  // a relay, a browser and a phone on mobile networks usually cannot reach
  // each other at all, and the failure is otherwise indistinguishable from
  // the far end simply not picking up.
  res.status(200).json({
    success: true,
    data: { iceServers: buildIceServers(), hasTurn: hasTurnConfigured() },
  });
});

export const postGuestReactionHandler = asyncHandler(async (req: Request, res: Response) => {
  const guest = getGuestContext(req);
  const { messageId, emoji } = req.body as { messageId: string; emoji: string };
  res.status(200).json({ success: true, data: await guestService.postGuestReaction(guest, messageId, emoji) });
});

export const markGuestReadHandler = asyncHandler(async (req: Request, res: Response) => {
  const guest = getGuestContext(req);
  res.status(200).json({ success: true, data: await guestService.markBusinessMessagesRead(guest) });
});

/* ------------------------------------------------------------------ *
 * Agent-facing — ordinary authenticated routes on a conversation.     *
 * ------------------------------------------------------------------ */

export const issueGuestLinkHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const conversationId = req.params.conversationId as string;
  res.status(201).json({
    success: true,
    data: await guestService.issueGuestLinkForConversation(auth, conversationId),
  });
});

export const guestLinkStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const conversationId = req.params.conversationId as string;
  res.status(200).json({ success: true, data: await guestService.getGuestLinkStatus(auth, conversationId) });
});

export const revokeGuestLinkHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const conversationId = req.params.conversationId as string;
  res.status(200).json({
    success: true,
    data: await guestService.revokeGuestLinkForConversation(auth, conversationId),
  });
});

export const sendGuestReplyHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const conversationId = req.params.conversationId as string;
  const { text } = req.body as { text: string };
  res.status(201).json({ success: true, data: await guestService.sendGuestReply(auth, conversationId, text) });
});

export const issueGuestLinkByPhoneHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const { phone, name } = req.body as { phone: string; name?: string };
  res.status(201).json({ success: true, data: await guestService.issueGuestLinkForPhone(auth, phone, name) });
});

/* ------------------------------------------------------------------ *
 * Images                                                              *
 * ------------------------------------------------------------------ */

/**
 * Several images in one request, each becoming its own message.
 *
 * One message per picture rather than one carrying many: the agent app,
 * the chat list and the WhatsApp thread this sits beside all model a
 * message as having at most one attachment, and a multi-image message
 * would have to be invented on both sides to display.
 *
 * Failures are per file. A request that stored three of four images has
 * genuinely delivered three, and rejecting the whole batch would lose
 * them to make the response tidier.
 */
export const uploadGuestMediaHandler = asyncHandler(async (req: Request, res: Response) => {
  const guest = getGuestContext(req);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    throw ApiError.badRequest('NO_FILES', 'No files were uploaded.');
  }

  const sent = [];
  const failed = [];
  for (const file of files) {
    try {
      // The kind comes back from the store rather than being decided here:
      // it is the same check that accepted the file, so a type this route
      // thinks is a photo can never be filed as one the store called audio.
      const { media, kind } = await storeGuestMedia({
        tenantId: guest.tenantId,
        whatsappPhoneNumberId: guest.whatsappPhoneNumberId,
        buffer: file.buffer,
        mimeType: file.mimetype,
      });
      sent.push(await guestService.postGuestMediaMessage(guest, String(media._id), kind));
    } catch (err) {
      failed.push({
        filename: file.originalname,
        message: err instanceof ApiError ? err.message : 'Could not send this file.',
      });
    }
  }

  if (sent.length === 0) {
    throw ApiError.badRequest('UPLOAD_FAILED', failed[0]?.message ?? 'Could not send those files.');
  }
  res.status(201).json({ success: true, data: sent, meta: { failed } });
});

/**
 * Widths the media route will serve.
 *
 * A fixed set rather than any number the client asks for: each distinct
 * width is a separate Cloudinary transformation and a separate cached
 * object, so an open parameter lets anyone with a link generate unbounded
 * variants of the same file.
 */
const ALLOWED_MEDIA_WIDTHS = new Set([480, 960]);

export const getGuestMediaHandler = asyncHandler(async (req: Request, res: Response) => {
  const guest = getGuestContext(req);
  const requested = Number(req.query.w);
  const maxWidth = ALLOWED_MEDIA_WIDTHS.has(requested) ? requested : undefined;
  const { buffer, mimeType } = await getGuestMediaBytes(guest, req.params.id as string, maxWidth);

  // A media id names one immutable file, so the browser never needs to ask
  // twice. Private because it is one customer's conversation, not
  // something a shared cache should hold.
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  // Two URLs for one media id now differ only by the query string, so the
  // width has to be part of what a cache keys on.
  res.setHeader('Vary', 'Accept-Encoding');
  res.type(mimeType).send(buffer);
});
