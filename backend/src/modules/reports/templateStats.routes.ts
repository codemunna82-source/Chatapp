import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { getTemplateStatsHandler } from './templateStats.controller';

export const templateStatsRouter = Router();

// MASTER_ADMIN only — see templateStats.service.ts for why.
templateStatsRouter.use(requireAuth, requireRole('MASTER_ADMIN'));

templateStatsRouter.get('/', getTemplateStatsHandler);
