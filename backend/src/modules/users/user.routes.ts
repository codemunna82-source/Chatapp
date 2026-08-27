import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createUserSchema,
  updateUserSchema,
  listUsersQuerySchema,
  userIdParamSchema,
} from './user.validation';
import {
  createUserHandler,
  listUsersHandler,
  getUserHandler,
  updateUserHandler,
  disableUserHandler,
} from './user.controller';

export const userRouter = Router();

// User management is a MASTER_ADMIN-only capability (spec §8, §27):
// creating/editing/disabling users, assigning permissions and validity.
userRouter.use(requireAuth, requireRole('MASTER_ADMIN'));

userRouter.get('/', validate({ query: listUsersQuerySchema }), listUsersHandler);
userRouter.post('/', validate({ body: createUserSchema }), createUserHandler);
userRouter.get('/:id', validate({ params: userIdParamSchema }), getUserHandler);
userRouter.patch(
  '/:id',
  validate({ params: userIdParamSchema, body: updateUserSchema }),
  updateUserHandler,
);
userRouter.delete('/:id', validate({ params: userIdParamSchema }), disableUserHandler);
