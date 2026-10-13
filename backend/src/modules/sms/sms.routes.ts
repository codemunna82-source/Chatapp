import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import { smsSyncSchema, smsSendSchema, smsConversationQuerySchema } from './sms.validation';
import { syncSmsHandler, sendSmsHandler, resolveSmsConversationHandler } from './sms.controller';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { issueSmsInviteLink } from '../guest/guest.service';

export const smsRouter = Router();

/**
 * POST /api/sms/sync — the periodic background catch-all (smsSync.ts's
 * SmsSyncRunner). There is no inbound webhook the way WhatsApp has one:
 * the actual SMS already arrived or left on the agent's own SIM
 * (sendSms in VoxoSmsAutoReplyModule.kt / SmsAutoReplyReceiver.kt)
 * before this is ever called. This only turns what the device already
 * has into persisted records every signed-in device can see — see
 * sms.service.ts's own doc comment.
 *
 * Gated on CHAT_SEND, the same permission an ordinary message send
 * uses: creating a Message and a Conversation is squarely that, even
 * though some of what is being recorded here was received, not sent.
 */
smsRouter.post('/sync', requireAuth, requirePermission('CHAT_SEND'), validate({ body: smsSyncSchema }), syncSmsHandler);

/**
 * POST /api/sms/send — the live composer's own call, right after the
 * text actually went out over the SIM (see useSendSmsMessage), so it
 * gets back the real, persisted Message instead of waiting for the
 * next /sync pass or realtime push. See sendSmsNow's own doc comment on
 * how this and the background sync avoid racing each other into two
 * records for the one text.
 */
smsRouter.post('/send', requireAuth, requirePermission('CHAT_SEND'), validate({ body: smsSendSchema }), sendSmsHandler);

/**
 * GET /api/sms/conversation?phone=... — find-or-create, for the one
 * caller that needs a conversation id back synchronously rather than
 * waiting on the next sync pass: the mobile app's deep-link resolver for
 * SmsAutoReplyReceiver.kt's lead-SMS notification tap. See
 * resolveSmsConversationId's own doc comment.
 */
smsRouter.get(
  '/conversation',
  requireAuth,
  requirePermission('CHAT_READ'),
  validate({ query: smsConversationQuerySchema }),
  resolveSmsConversationHandler,
);

/**
 * POST /api/sms/invite-link {phone} — the private chat link for this number,
 * which the app then texts from the agent's own SIM. Only the phone number
 * is sent here, never SMS content.
 */
smsRouter.post(
  '/invite-link',
  requireAuth,
  requirePermission('CHAT_SEND'),
  validate({ body: smsConversationQuerySchema }),
  asyncHandler(async (req, res) => {
    const { phone } = req.body as { phone: string };
    const link = await issueSmsInviteLink(getTenantContext(req), phone);
    res.status(200).json({ success: true, data: link });
  }),
);
