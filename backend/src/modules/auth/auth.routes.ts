import { Router } from 'express';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { authRateLimiter } from '../../middleware/rateLimit.middleware';
import {
  loginSchema,
  refreshSchema,
  logoutSchema,
  changePasswordSchema,
} from './auth.validation';
import {
  loginHandler,
  refreshHandler,
  logoutHandler,
  changePasswordHandler,
} from './auth.controller';

export const authRouter = Router();

authRouter.post('/login', authRateLimiter, validate({ body: loginSchema }), loginHandler);
authRouter.post('/refresh', authRateLimiter, validate({ body: refreshSchema }), refreshHandler);
authRouter.post('/logout', validate({ body: logoutSchema }), logoutHandler);
authRouter.post(
  '/change-password',
  requireAuth,
  validate({ body: changePasswordSchema }),
  changePasswordHandler,
);
