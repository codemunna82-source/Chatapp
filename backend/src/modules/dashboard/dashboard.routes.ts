import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { getDashboardHandler } from './dashboard.controller';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth, requirePermission('ANALYTICS_VIEW'));

dashboardRouter.get('/', getDashboardHandler);
