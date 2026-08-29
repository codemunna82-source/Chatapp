import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { registerDeviceSchema, unregisterDeviceSchema } from './deviceToken.validation';
import { registerDeviceHandler, unregisterDeviceHandler } from './deviceToken.controller';

export const deviceRouter = Router();

deviceRouter.use(requireAuth);

// No permission gate: registering the device you are already signed in on
// is not a privileged action, and gating it would mean a team member with
// read-only chat access silently gets no notifications.
deviceRouter.post('/', validate({ body: registerDeviceSchema }), registerDeviceHandler);
deviceRouter.delete('/', validate({ body: unregisterDeviceSchema }), unregisterDeviceHandler);
