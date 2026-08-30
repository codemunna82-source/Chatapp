import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import { listCallsQuerySchema, initiateCallSchema, callIdParamSchema, answerCallSchema } from './call.validation';
import {
  listCallsHandler,
  initiateCallHandler,
  answerCallHandler,
  rejectCallHandler,
  hangUpCallHandler,
} from './call.controller';

export const callRouter = Router();

callRouter.use(requireAuth);

callRouter.get('/', requirePermission('CALL_HISTORY'), validate({ query: listCallsQuerySchema }), listCallsHandler);
callRouter.post('/', requirePermission('CALL_ACCESS'), validate({ body: initiateCallSchema }), initiateCallHandler);

// Answering a live WhatsApp call. Gated on CALL_ACCESS like placing one,
// and each handler re-checks that the call arrived on this user's own
// number — the call id comes from the client, and a push notification is
// not proof of ownership.
callRouter.post(
  '/:callId/answer',
  requirePermission('CALL_ACCESS'),
  validate({ params: callIdParamSchema, body: answerCallSchema }),
  answerCallHandler,
);
callRouter.post(
  '/:callId/reject',
  requirePermission('CALL_ACCESS'),
  validate({ params: callIdParamSchema }),
  rejectCallHandler,
);
callRouter.post(
  '/:callId/hangup',
  requirePermission('CALL_ACCESS'),
  validate({ params: callIdParamSchema }),
  hangUpCallHandler,
);
