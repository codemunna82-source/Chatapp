import { DeviceToken, type DeviceTokenDoc, type DevicePlatform } from './deviceToken.model';

export interface RegisterDeviceInput {
  tenantId: string;
  userId: string;
  token: string;
  platform: DevicePlatform;
}

/**
 * Upsert on the token, so re-registering the same install re-points it at
 * whoever is signed in now rather than leaving it attached to the previous
 * user (see the model's note).
 */
export async function registerDeviceToken(input: RegisterDeviceInput): Promise<DeviceTokenDoc | null> {
  return DeviceToken.findOneAndUpdate(
    { token: input.token },
    {
      $set: {
        tenantId: input.tenantId,
        userId: input.userId,
        platform: input.platform,
        lastSeenAt: new Date(),
      },
    },
    { new: true, upsert: true },
  );
}

export async function unregisterDeviceToken(token: string): Promise<void> {
  await DeviceToken.deleteOne({ token });
}

/** Every device belonging to this tenant — the fan-out target for a new
 *  customer message, which any agent in the workspace may need to see. */
export async function listTokensForTenant(tenantId: string): Promise<DeviceTokenDoc[]> {
  return DeviceToken.find({ tenantId });
}

/** Same, minus one user's devices — used when the person who caused the
 *  event should not be pinged about their own action. */
export async function listTokensForTenantExcludingUser(
  tenantId: string,
  excludeUserId: string,
): Promise<DeviceTokenDoc[]> {
  return DeviceToken.find({ tenantId, userId: { $ne: excludeUserId } });
}

/**
 * Removes tokens FCM has told us are gone (UNREGISTERED / INVALID_ARGUMENT).
 * Without this, a workspace accumulates dead tokens forever and every
 * notification costs a growing number of failed requests.
 */
export async function deleteTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await DeviceToken.deleteMany({ token: { $in: tokens } });
}

/** Device tokens for a named set of users, for a scoped push. */
export async function listTokensForUsers(tenantId: string, userIds: string[]): Promise<DeviceTokenDoc[]> {
  if (userIds.length === 0) return [];
  return DeviceToken.find({ tenantId, userId: { $in: userIds } });
}
