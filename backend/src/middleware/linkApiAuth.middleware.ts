import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/ApiError';
import { asyncHandler } from '../lib/asyncHandler';
import { findPhoneNumberByLinkApiKey } from '../modules/whatsapp/linkApiKey';

/**
 * Authenticates an external automation calling the public guest-link API.
 *
 * Its own header rather than Authorization: Bearer, so this request can
 * never be mistaken for a guest link token or a user's JWT by anything
 * downstream that only checks the header is present — the three carry
 * disjoint credentials and must never be interchangeable.
 */
const HEADER_NAME = 'x-voxo-link-key';

export const requireLinkApiKey = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const key = req.headers[HEADER_NAME];
    if (typeof key !== 'string' || !key) {
      throw ApiError.unauthorized('LINK_API_KEY_REQUIRED', 'Missing X-VOXO-Link-Key header');
    }
    const phoneNumber = await findPhoneNumberByLinkApiKey(key);
    if (!phoneNumber) {
      throw ApiError.unauthorized('LINK_API_KEY_INVALID', 'That key is not valid or has been rotated');
    }
    req.linkApiPhoneNumber = phoneNumber;
    next();
  },
);
