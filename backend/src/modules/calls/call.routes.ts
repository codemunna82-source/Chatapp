import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import { listCallsQuerySchema, initiateCallSchema } from './call.validation';
import { listCallsHandler, initiateCallHandler } from './call.controller';

export const callRouter = Router();

callRouter.use(requireAuth);

callRouter.get('/', requirePermission('CALL_HISTORY'), validate({ query: listCallsQuerySchema }), listCallsHandler);
callRouter.post('/', requirePermission('CALL_ACCESS'), validate({ body: initiateCallSchema }), initiateCallHandler);
