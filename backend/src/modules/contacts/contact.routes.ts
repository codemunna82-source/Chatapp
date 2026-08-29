import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createContactSchema,
  updateContactSchema,
  listContactsQuerySchema,
  contactIdParamSchema,
} from './contact.validation';
import multer from 'multer';
import { AVATAR_MAX_SIZE_BYTES } from '../users/user.service';
import {
  createContactHandler,
  listContactsHandler,
  getContactHandler,
  updateContactHandler,
  deleteContactHandler,
  updateContactAvatarHandler,
  getContactAvatarHandler,
} from './contact.controller';

export const contactRouter = Router();

contactRouter.use(requireAuth);

// In-memory only — the bytes go straight to Cloudinary and never touch
// local disk, which would be pointless on an ephemeral deployment anyway.
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: AVATAR_MAX_SIZE_BYTES } });

// A contact photo is workspace-owned, not fetched from WhatsApp — Meta's
// Cloud API exposes no way to read a customer's profile picture. Reading
// it needs CHAT_READ, setting it CHAT_SEND, matching the rest of the
// contact surface.
contactRouter.get(
  '/:id/avatar',
  requirePermission('CHAT_READ'),
  validate({ params: contactIdParamSchema }),
  getContactAvatarHandler,
);
contactRouter.patch(
  '/:id/avatar',
  requirePermission('CHAT_SEND'),
  avatarUpload.single('file'),
  validate({ params: contactIdParamSchema }),
  updateContactAvatarHandler,
);

// Contacts are the customer directory a conversation is chatted against —
// gated behind CHAT_READ/CHAT_SEND like the rest of the chat surface
// (spec §9), not a separate contact-specific permission.
contactRouter.get('/', requirePermission('CHAT_READ'), validate({ query: listContactsQuerySchema }), listContactsHandler);
contactRouter.post('/', requirePermission('CHAT_SEND'), validate({ body: createContactSchema }), createContactHandler);
contactRouter.get(
  '/:id',
  requirePermission('CHAT_READ'),
  validate({ params: contactIdParamSchema }),
  getContactHandler,
);
contactRouter.patch(
  '/:id',
  requirePermission('CHAT_SEND'),
  validate({ params: contactIdParamSchema, body: updateContactSchema }),
  updateContactHandler,
);

// Deleting a contact also removes their conversations and messages from
// this workspace — see contact.service.ts for why the cascade is required.
contactRouter.delete(
  '/:id',
  requirePermission('CHAT_SEND'),
  validate({ params: contactIdParamSchema }),
  deleteContactHandler,
);
