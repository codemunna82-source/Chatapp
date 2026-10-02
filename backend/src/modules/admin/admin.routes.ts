import { Router } from 'express';
import { apiRateLimiter } from '../../middleware/rateLimit.middleware';
import { adminConsolePageHandler, adminConsoleScriptHandler } from './adminConsole.controller';

/**
 * The admin console's own two routes.
 *
 * Unauthenticated, and they have to be: the page is what the admin signs
 * in THROUGH. It ships no credentials — only markup and a script that
 * posts to the same /api/auth/login every client uses, and every endpoint
 * the page then calls enforces MASTER_ADMIN on the server exactly as
 * before. Serving the page to an anonymous visitor hands them a login
 * form and nothing else.
 */
export const adminRouter = Router();

adminRouter.get('/console', apiRateLimiter, adminConsolePageHandler);
adminRouter.get('/console.js', apiRateLimiter, adminConsoleScriptHandler);
