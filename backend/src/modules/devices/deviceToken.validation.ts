import { z } from 'zod';
import { DEVICE_PLATFORMS } from './deviceToken.model';

export const registerDeviceSchema = z.object({
  // FCM tokens are long opaque strings; the bounds only keep obvious junk
  // and unbounded input out of the database.
  token: z.string().trim().min(20).max(4096),
  platform: z.enum(DEVICE_PLATFORMS),
});

export const unregisterDeviceSchema = z.object({
  token: z.string().trim().min(20).max(4096),
});
