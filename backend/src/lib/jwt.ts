import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export type UserRole = 'MASTER_ADMIN' | 'SUB_USER';

/** Claims carried by a short-lived access token. */
export interface AccessTokenClaims {
  sub: string; // userId
  tenantId: string;
  role: UserRole;
  type: 'access';
}

/** Claims carried by a rotating refresh token. `jti` ties it to a stored, revocable record. */
export interface RefreshTokenClaims {
  sub: string; // userId
  tenantId: string;
  jti: string; // refresh token record id, for revocation/rotation checks
  type: 'refresh';
}

export function signAccessToken(claims: Omit<AccessTokenClaims, 'type'>): string {
  const payload: AccessTokenClaims = { ...claims, type: 'access' };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  } as SignOptions);
}

export function signRefreshToken(claims: Omit<RefreshTokenClaims, 'type'>): string {
  const payload: RefreshTokenClaims = { ...claims, type: 'refresh' };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenClaims;
  if (decoded.type !== 'access') {
    throw new Error('Not an access token');
  }
  return decoded;
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenClaims;
  if (decoded.type !== 'refresh') {
    throw new Error('Not a refresh token');
  }
  return decoded;
}
