import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { listTemplatesHandler } from './messageTemplate.controller';

export const messageTemplateRouter = Router();

messageTemplateRouter.get('/', requireAuth, requirePermission('CHAT_READ'), listTemplatesHandler);
