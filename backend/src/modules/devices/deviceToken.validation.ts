import { z } from 'zod';
import { DEVICE_PLATFORMS } from './deviceToken.model';

export const registerDeviceSchema = z.object({
  // FCM tokens are long opaque strings; the bounds only keep obvious junk
  // and unbounded input out of the database.
  token: z.string().trim().min(20).max(4096),
  platform: z.enum(DEVICE_PLATFORMS),
  /**
   * Optional: older app builds do not send it, and refusing those would
   * unregister every phone that has not updated — for a field that only
   * chooses a ringtone.
   */
  callChannelId: z
    .string()
    .trim()
    .max(120)
    // The app's own ids, and nothing else. A channel id is echoed straight
    // back to FCM, so it is not a place to accept arbitrary strings.
    .regex(/^voxo-calls(-[a-z0-9]+)?$/, 'Not a VOXO call channel')
    .optional(),
});

export const unregisterDeviceSchema = z.object({
  token: z.string().trim().min(20).max(4096),
});
