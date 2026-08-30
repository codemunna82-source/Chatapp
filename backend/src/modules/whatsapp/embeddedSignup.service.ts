import { ApiError } from '../../lib/ApiError';
import { logger } from '../../lib/logger';
import { encryptSecret } from '../../lib/crypto';
import { env } from '../../config/env';
import { recordAudit } from '../audit/auditLog.service';
import {
  exchangeCodeForToken,
  findWabaIdForToken,
  listWabaPhoneNumbers,
  registerPhoneNumber,
  subscribeAppToWaba,
} from '../../integrations/meta/oauth';
import { WhatsAppAccount } from './whatsappAccount.model';
import { WhatsAppPhoneNumber } from './whatsappPhoneNumber.model';
import { User } from '../users/user.model';
import { invalidateAuthContext } from '../auth/authContext.service';

export interface ConnectionStatus {
  connected: boolean;
  displayPhoneNumber?: string;
  verifiedName?: string;
  phoneNumberId?: string;
  wabaId?: string;
  connectedAt?: Date;
  /** Absent means the token does not expire, not that it expires now. */
  tokenExpiresAt?: Date;
  /** Null when there is no expiry; negative once it has passed. */
  daysUntilExpiry?: number | null;
  /**
   * The connection needs the user to run Embedded Signup again — either the
   * token expired, or a send already came back from Meta as unauthorised.
   */
  needsReconnect?: boolean;
}

const RECONNECT_WARNING_DAYS = 7;

/** Whole days from now until `at`, negative once it is past. */
function daysUntil(at: Date): number {
  return Math.floor((at.getTime() - Date.now()) / 86_400_000);
}

/**
 * What the user's own WhatsApp connection currently is.
 *
 * Keyed on ownerUserId, so this reports only what *this* user connected —
 * never the tenant's shared number, which they did not onboard and cannot
 * disconnect.
 */
export async function getConnectionStatus(tenantId: string, userId: string): Promise<ConnectionStatus> {
  // EXPIRED is included, unlike DISCONNECTED: an expired connection still
  // has a number worth showing, and the user needs to be told to reconnect
  // rather than shown a blank "not connected" that hides why sends broke.
  const account = await WhatsAppAccount.findOne({
    tenantId,
    ownerUserId: userId,
    status: { $in: ['CONNECTED', 'EXPIRED'] },
  });
  if (!account) return { connected: false };

  const number = await WhatsAppPhoneNumber.findOne({ tenantId, ownerUserId: userId }).sort({ createdAt: -1 });
  const expiresAt = account.tokenExpiresAt ?? undefined;
  const remaining = expiresAt ? daysUntil(expiresAt) : null;

  return {
    connected: account.status === 'CONNECTED',
    wabaId: account.wabaId,
    connectedAt: account.connectedAt ?? undefined,
    phoneNumberId: number?.phoneNumberId,
    displayPhoneNumber: number?.displayPhoneNumber,
    verifiedName: account.businessName ?? undefined,
    tokenExpiresAt: expiresAt,
    daysUntilExpiry: remaining,
    // A send that already failed as unauthorised is the strongest signal
    // there is — stronger than the clock, since a token can be revoked
    // long before its expiry date.
    needsReconnect: account.status === 'EXPIRED' || (remaining !== null && remaining <= RECONNECT_WARNING_DAYS),
  };
}

/**
 * Marks a connection as needing reconnection after Meta rejected its token.
 *
 * Called from the send path on a META_AUTH_ERROR. Without this the only
 * symptom of an expired token is every message failing with a generic
 * error, and nothing anywhere telling the user that reconnecting fixes it.
 */
export async function markConnectionExpired(whatsappAccountId: string): Promise<void> {
  const result = await WhatsAppAccount.updateOne(
    { _id: whatsappAccountId, status: 'CONNECTED' },
    { $set: { status: 'EXPIRED' } },
  );
  if (result.modifiedCount > 0) {
    logger.warn({ whatsappAccountId }, 'WhatsApp token rejected by Meta — connection marked EXPIRED');
  }
}

/**
 * Turns the code Embedded Signup returned into a stored, working
 * connection owned by this user.
 *
 * The order matters. Register and subscribe come *before* the connection is
 * marked CONNECTED, because an account that is stored as connected but was
 * never subscribed can send and looks entirely healthy while silently
 * never receiving a reply — the worst possible failure to debug.
 *
 * Nothing here trusts the client. The WABA id is read out of the token via
 * debug_token rather than taken from the request, so a crafted call cannot
 * attach someone else's business; the phone numbers come from Meta, not
 * from the WebView.
 */
export async function connectWhatsAppForUser(
  tenantId: string,
  userId: string,
  code: string,
): Promise<ConnectionStatus> {
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw ApiError.badRequest(
      'META_APP_NOT_CONFIGURED',
      'The server is missing META_APP_ID or META_APP_SECRET, so it cannot complete the connection.',
    );
  }
  if (!env.ENCRYPTION_KEY) {
    // Refused rather than stored in plaintext. A connected account whose
    // token sits unencrypted in Mongo is worse than a failed connection.
    throw ApiError.badRequest(
      'ENCRYPTION_NOT_CONFIGURED',
      'The server has no ENCRYPTION_KEY, so it cannot store WhatsApp credentials safely.',
    );
  }

  let exchanged;
  try {
    exchanged = await exchangeCodeForToken(code);
  } catch (err) {
    logger.warn({ err, userId }, 'Embedded Signup code exchange failed');
    throw ApiError.badRequest(
      'WHATSAPP_CODE_EXCHANGE_FAILED',
      `Meta rejected the authorization: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }

  const accessToken = exchanged.accessToken;
  const wabaId = await findWabaIdForToken(accessToken);
  if (!wabaId) {
    throw ApiError.badRequest(
      'WHATSAPP_NO_WABA_GRANTED',
      'The Meta authorization did not include a WhatsApp Business Account. Please run the connection again and select a business.',
    );
  }

  const numbers = await listWabaPhoneNumbers(accessToken, wabaId);
  if (numbers.length === 0) {
    throw ApiError.badRequest(
      'WHATSAPP_NO_PHONE_NUMBER',
      'That WhatsApp Business Account has no phone number yet. Add and verify one in Meta, then connect again.',
    );
  }
  const primary = numbers[0]!;

  // Another workspace already holds this number. phoneNumberId is globally
  // unique because it is the only key an inbound webhook carries, so two
  // owners would make inbound routing ambiguous.
  const clash = await WhatsAppPhoneNumber.findOne({ phoneNumberId: primary.phoneNumberId });
  if (clash && String(clash.tenantId) !== tenantId) {
    throw ApiError.conflict(
      'WHATSAPP_NUMBER_ALREADY_CONNECTED',
      'That WhatsApp number is already connected to another workspace.',
    );
  }

  if (env.META_REGISTER_PIN) {
    try {
      await registerPhoneNumber(accessToken, primary.phoneNumberId);
    } catch (err) {
      // Already-registered is the common case on a reconnect and is not a
      // failure; anything else is, and is worth seeing.
      logger.warn({ err, phoneNumberId: primary.phoneNumberId }, 'register call failed — continuing');
    }
  }

  try {
    await subscribeAppToWaba(accessToken, wabaId);
  } catch (err) {
    // Fatal, unlike register: without the subscription this connection can
    // send and will never receive, which looks like success.
    logger.error({ err, wabaId }, 'subscribed_apps failed');
    throw ApiError.badRequest(
      'WHATSAPP_WEBHOOK_SUBSCRIBE_FAILED',
      'Connected to Meta but could not subscribe to incoming messages. Please try again.',
    );
  }

  const account = await WhatsAppAccount.findOneAndUpdate(
    { tenantId, ownerUserId: userId },
    {
      $set: {
        wabaId,
        businessName: primary.verifiedName,
        accessTokenEnc: encryptSecret(accessToken),
        // Superseded by accessTokenEnc; kept non-empty because the field is
        // required and older documents still carry a real placeholder.
        accessTokenRef: 'enc:accessTokenEnc',
        verifyToken: env.META_VERIFY_TOKEN || 'unset',
        status: 'CONNECTED',
        connectedAt: new Date(),
        // Only when Meta actually reported one. The "60 day expiration"
        // Embedded Signup templates do; a permanent System User token does
        // not, and writing a date for it would nag the user forever.
        tokenExpiresAt: exchanged.expiresInSeconds
          ? new Date(Date.now() + exchanged.expiresInSeconds * 1000)
          : null,
      },
    },
    { new: true, upsert: true },
  );

  const number = await WhatsAppPhoneNumber.findOneAndUpdate(
    { phoneNumberId: primary.phoneNumberId },
    {
      $set: {
        tenantId,
        ownerUserId: userId,
        whatsappAccountId: account._id,
        displayPhoneNumber: primary.displayPhoneNumber,
        qualityRating: primary.qualityRating,
        status: 'CONNECTED',
      },
    },
    { new: true, upsert: true },
  );

  // The user now sends from, and sees, their own number — the same field
  // an admin sets by hand in the Team screen.
  await User.updateOne({ _id: userId, tenantId }, { $set: { whatsappPhoneNumberId: number!._id } });
  invalidateAuthContext(userId, tenantId);

  await recordAudit({
    tenantId,
    actorUserId: userId,
    action: 'whatsapp.connect',
    targetType: 'WhatsAppAccount',
    targetId: account._id,
    metadata: { wabaId, phoneNumberId: primary.phoneNumberId },
  });

  logger.info({ userId, wabaId, phoneNumberId: primary.phoneNumberId }, 'WhatsApp connected');
  return {
    connected: true,
    wabaId,
    phoneNumberId: primary.phoneNumberId,
    displayPhoneNumber: primary.displayPhoneNumber,
    verifiedName: primary.verifiedName,
    connectedAt: account.connectedAt ?? undefined,
  };
}

/**
 * Disconnects this user's own WhatsApp connection.
 *
 * Marks the records DISCONNECTED and drops the stored token rather than
 * deleting anything: the conversations and messages that came through this
 * number stay readable, which is what a user reconnecting — or leaving —
 * actually expects. Meta is not called; revoking the business's own
 * authorization is theirs to do, not ours.
 */
export async function disconnectWhatsAppForUser(tenantId: string, userId: string): Promise<void> {
  const account = await WhatsAppAccount.findOne({ tenantId, ownerUserId: userId });
  if (!account) {
    throw ApiError.notFound('WHATSAPP_NOT_CONNECTED', 'There is no WhatsApp connection to disconnect.');
  }

  await WhatsAppAccount.updateOne(
    { _id: account._id },
    { $set: { status: 'DISCONNECTED' }, $unset: { accessTokenEnc: '' } },
  );
  await WhatsAppPhoneNumber.updateMany({ tenantId, ownerUserId: userId }, { $set: { status: 'DISCONNECTED' } });
  await User.updateOne({ _id: userId, tenantId }, { $unset: { whatsappPhoneNumberId: '' } });
  invalidateAuthContext(userId, tenantId);

  await recordAudit({
    tenantId,
    actorUserId: userId,
    action: 'whatsapp.disconnect',
    targetType: 'WhatsAppAccount',
    targetId: account._id,
  });
}
