import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createUserSchema,
  updateUserSchema,
  listUsersQuerySchema,
  userIdParamSchema,
} from './user.validation';
import { AVATAR_MAX_SIZE_BYTES } from './user.service';
import {
  createUserHandler,
  listUsersHandler,
  getUserHandler,
  updateUserHandler,
  disableUserHandler,
  updateOwnAvatarHandler,
  getUserAvatarHandler,
} from './user.controller';

export const userRouter = Router();

// In-memory only — the file never touches local disk (irrelevant on a
// horizontally-scaled/ephemeral deployment anyway), and is small (see
// AVATAR_MAX_SIZE_BYTES) since it's stored inline on the User document.
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: AVATAR_MAX_SIZE_BYTES } });

// Profile picture routes come before the MASTER_ADMIN-only guard below:
// every authenticated tenant member — not just MASTER_ADMIN — can update
// their own avatar and view a teammate's (avatars aren't sensitive, and
// need to render in Team/chat UI for regular SUB_USERs too).
userRouter.patch('/me/avatar', requireAuth, avatarUpload.single('file'), updateOwnAvatarHandler);
userRouter.get('/:id/avatar', requireAuth, validate({ params: userIdParamSchema }), getUserAvatarHandler);

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
