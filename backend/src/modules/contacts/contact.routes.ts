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
import {
  createContactHandler,
  listContactsHandler,
  getContactHandler,
  updateContactHandler,
  deleteContactHandler,
} from './contact.controller';

export const contactRouter = Router();

contactRouter.use(requireAuth);

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
