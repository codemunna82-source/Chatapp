import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import { registerPhoneNumberSchema, connectWhatsAppSchema } from './whatsapp.validation';
import {
  listPhoneNumbersHandler,
  registerPhoneNumberHandler,
  connectWhatsAppHandler,
  whatsappStatusHandler,
  disconnectWhatsAppHandler,
} from './whatsapp.controller';
import { whatsappSignupPageHandler, whatsappSignupCallbackHandler } from './signupPage.controller';

export const whatsappRouter = Router();

// The Embedded Signup page itself is unauthenticated, and has to be: it is
// loaded by a WebView before any of our own credentials are in play, and it
// contains only the public app id and config id. It never calls our API —
// the app posts the resulting code to /connect with its own session.
whatsappRouter.get('/signup', whatsappSignupPageHandler);
// Where Facebook redirects back to. Must match the redirect URI built in
// whatsappSignupPageHandler, and be allow-listed in the Meta app's
// "Valid OAuth Redirect URIs" — Meta refuses the dialog otherwise.
whatsappRouter.get('/signup/callback', whatsappSignupCallbackHandler);

// Connecting a WhatsApp account is every user's own action, not an admin's,
// so these three sit above the MASTER_ADMIN guard. Each is scoped to the
// authenticated user inside the handler.
whatsappRouter.post('/connect', requireAuth, validate({ body: connectWhatsAppSchema }), connectWhatsAppHandler);
whatsappRouter.get('/status', requireAuth, whatsappStatusHandler);
whatsappRouter.post('/disconnect', requireAuth, disconnectWhatsAppHandler);

// MASTER_ADMIN only: the sole consumer is the Team screen's "sends from"
// picker, which is itself admin-only. A SUB_USER has no use for the list —
// they don't choose their own number, their admin assigns it.
whatsappRouter.use(requireAuth, requireRole('MASTER_ADMIN'));

whatsappRouter.get('/numbers', listPhoneNumbersHandler);
whatsappRouter.post('/numbers', validate({ body: registerPhoneNumberSchema }), registerPhoneNumberHandler);
