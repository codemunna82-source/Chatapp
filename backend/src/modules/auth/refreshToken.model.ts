import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * Server-side record backing every issued refresh token, enabling rotation
 * and reuse detection. The raw JWT is never stored — only a SHA-256 hash of
 * it — so a database leak alone can't be used to impersonate a session.
 *
 * Rotation: each successful /auth/refresh call revokes the token used and
 * issues a new one carrying the same `family`. If a *revoked* token is ever
 * presented again, that's a signal of token theft — the whole family is
 * revoked, forcing re-login on every device sharing that session lineage.
 */
const refreshTokenSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jti: { type: String, required: true },
    tokenHash: { type: String, required: true },
    family: { type: String, required: true, index: true },
    revokedAt: { type: Date },
    replacedByJti: { type: String },
    expiresAt: { type: Date, required: true },
    userAgent: { type: String },
    ip: { type: String },
  },
  { timestamps: true },
);

refreshTokenSchema.index({ jti: 1 }, { unique: true });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL cleanup

export type RefreshTokenDoc = HydratedDocument<InferSchemaType<typeof refreshTokenSchema>>;
export const RefreshToken = model('RefreshToken', refreshTokenSchema);
