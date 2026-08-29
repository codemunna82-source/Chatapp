import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { listPhoneNumbersHandler } from './whatsapp.controller';

export const whatsappRouter = Router();

// MASTER_ADMIN only: the sole consumer is the Team screen's "sends from"
// picker, which is itself admin-only. A SUB_USER has no use for the list —
// they don't choose their own number, their admin assigns it.
whatsappRouter.use(requireAuth, requireRole('MASTER_ADMIN'));

whatsappRouter.get('/numbers', listPhoneNumbersHandler);
