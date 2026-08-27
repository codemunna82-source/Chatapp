import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { ApiError } from '../../lib/ApiError';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { assertPermission } from '../../middleware/rbac.middleware';
import { findConversationByIdAndTenant } from '../conversations/conversation.repository';
import { listMessagesByConversation } from './message.repository';
import { sendOutboundMessage, type SendableMessageType } from './message.service';
import { toRealtimeMessage } from '../../realtime/serializers';

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document']);

export const listMessagesHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const conversationId = req.params.conversationId as string;

  const conversation = await findConversationByIdAndTenant(conversationId, auth.tenantId);
  if (!conversation) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
  }

  const { cursor, limit } = req.query as { cursor?: string; limit?: number };
  const { items, nextCursor } = await listMessagesByConversation(auth.tenantId, conversationId, { cursor, limit });
  res.status(200).json({ success: true, data: items.map(toRealtimeMessage), meta: { nextCursor } });
});

export const sendMessageHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const conversationId = req.params.conversationId as string;
  const body = req.body as { type: SendableMessageType } & Record<string, unknown>;

  // Baseline CHAT_SEND is required at the route level; type-specific
  // permissions layer on top since a static route middleware can't inspect
  // the request body (spec §9's permission list treats these separately).
  if (MEDIA_TYPES.has(body.type)) {
    assertPermission(auth, 'CHAT_MEDIA');
  }
  if (body.type === 'template') {
    assertPermission(auth, 'CHAT_TEMPLATE');
  }
  if (body.type === 'reaction') {
    assertPermission(auth, 'CHAT_REACTION');
  }

  const message = await sendOutboundMessage({
    tenantId: auth.tenantId,
    conversationId,
    senderId: auth.userId,
    ...body,
  } as never);

  res.status(201).json({ success: true, data: toRealtimeMessage(message) });
});
