import { Types } from 'mongoose';
import { WhatsAppAccount, type WhatsAppAccountDoc } from './whatsappAccount.model';
import { MetaApp } from './metaApp.model';
import { readAppSecret, findMetaAppByIdAndTenant } from './metaApp.repository';
import { WhatsAppPhoneNumber, type WhatsAppPhoneNumberDoc } from './whatsappPhoneNumber.model';
import { findPhoneNumbersByTenant, findPhoneNumberByIdAndTenant } from './whatsapp.repository';
import { ApiError } from '../../lib/ApiError';
import { env } from '../../config/env';
import { decryptSecret, isEncryptedEnvelope } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import { getMetaGateway } from '../../integrations/meta';
import type { MetaCredentials } from '../../integrations/meta';
import { describeNumberHealth, type NumberHealth } from './numberHealth';
import { registerPhoneNumber, subscribeAppToWaba } from '../../integrations/meta/oauth';
import { User } from '../users/user.model';
import { invalidateAuthContext } from '../auth/authContext.service';

/**
 * Turns a stored `accessTokenRef` into the token to actually call Meta with.
 *
 * The seed writes the literal placeholder `mock:demo-access-token`, which is
 * fine against the mock gateway and useless against the real one — a send
 * with it comes back as Meta error 190. So a `mock:` ref, an `env:` ref (what
 * findOrCreateRealAccount writes) or an empty one defers to META_ACCESS_TOKEN
 * from the environment, which is where a real System User token belongs. A
 * ref that is a real token is used as-is.
 *
 * This is the reason setting META_ACCESS_TOKEN on the server is enough to
 * start sending for real, without hand-editing the WhatsAppAccount document.
 *
 * `accessTokenEnc`, when present, wins over everything: it is the encrypted
 * token Embedded Signup obtained for this specific account, so a user who
 * connected their own WhatsApp sends with their own credentials rather than
 * the platform's.
 *
 * The three-way order — own encrypted token, then a literal stored token,
 * then the environment — is what lets the existing single-number
 * deployment keep working unchanged while connected accounts use their own.
 */
export function resolveAccessToken(accessTokenRef: string | undefined, accessTokenEnc?: string | null): string {
  if (accessTokenEnc && isEncryptedEnvelope(accessTokenEnc)) {
    try {
      return decryptSecret(accessTokenEnc);
    } catch (err) {
      // Almost always a rotated ENCRYPTION_KEY. Falling through to the
      // platform token would silently send this customer's messages from
      // the wrong number, so this fails instead and says what to do.
      logger.error({ err }, 'Stored WhatsApp token could not be decrypted');
      throw ApiError.badRequest(
        'WHATSAPP_TOKEN_UNREADABLE',
        'This WhatsApp connection could not be read. Please disconnect and connect WhatsApp again.',
      );
    }
  }

  const ref = accessTokenRef?.trim() ?? '';
  const isPlaceholder = ref.length === 0 || ref.startsWith('mock:') || ref.startsWith('env:') || ref.startsWith('enc:');
  const token = isPlaceholder ? env.META_ACCESS_TOKEN : ref;
  if (token.length === 0) {
    throw ApiError.badRequest(
      'WHATSAPP_TOKEN_NOT_CONFIGURED',
      'No WhatsApp access token is configured on the server, so messages cannot be sent.',
    );
  }
  return token;
}

/**
 * The token to act as this account, most specific source first.
 *
 * 1. The account's own token, from Embedded Signup. Most specific, so it
 *    wins — it was issued for this WABA and nothing else.
 * 2. Its Business Manager's token, when the account has no token of its
 *    own. This is what makes a second BM work: numbers added by hand under
 *    it have no per-account token, and the global META_ACCESS_TOKEN belongs
 *    to a different Business Manager entirely, so sending with it would
 *    fail with a permissions error that names nothing useful.
 * 3. The global token, which is the single-BM deployment this all grew
 *    out of and must keep working.
 *
 * An app whose token will not decrypt falls through to (3) rather than
 * throwing: a rotated ENCRYPTION_KEY should not be a total outage when a
 * working global token is sitting right there. A rotated key on the
 * ACCOUNT's own token still throws, because there the alternative is
 * sending this customer's message from some other business's number.
 */
async function resolveAccountAccessToken(account: {
  accessTokenRef?: string | null;
  accessTokenEnc?: string | null;
  metaAppId?: unknown;
}): Promise<string> {
  if (account.accessTokenEnc && isEncryptedEnvelope(account.accessTokenEnc)) {
    return resolveAccessToken(account.accessTokenRef ?? undefined, account.accessTokenEnc);
  }

  if (account.metaAppId) {
    const app = await MetaApp.findById(String(account.metaAppId)).select('+accessTokenEnc');
    const appToken = readAppSecret(app?.accessTokenEnc);
    if (appToken) return appToken;
  }

  return resolveAccessToken(account.accessTokenRef ?? undefined, account.accessTokenEnc);
}

/**
 * Resolves the Meta credentials needed to act on behalf of one tenant's
 * WhatsApp connection, from our own tenant-scoped records — never from
 * anything the Android client sends.
 */
/**
 * MetaCredentials plus the account they came from.
 *
 * The extra field stays out of MetaCredentials itself — that is the Meta
 * gateway's own type and has no business knowing about our documents. It
 * rides along here so the send path can mark this exact connection EXPIRED
 * when Meta rejects the token, instead of re-deriving it from an error
 * that carries no account context.
 */
export type ResolvedMetaCredentials = MetaCredentials & { whatsappAccountId: string };

export async function resolveMetaCredentialsForPhoneNumber(
  tenantId: string,
  whatsappPhoneNumberId: string,
): Promise<ResolvedMetaCredentials> {
  if (!Types.ObjectId.isValid(whatsappPhoneNumberId)) {
    throw ApiError.notFound('WHATSAPP_PHONE_NUMBER_NOT_FOUND', 'WhatsApp phone number not found');
  }
  const phoneNumber = await WhatsAppPhoneNumber.findOne({ _id: whatsappPhoneNumberId, tenantId });
  if (!phoneNumber) {
    throw ApiError.notFound('WHATSAPP_PHONE_NUMBER_NOT_FOUND', 'WhatsApp phone number not found');
  }

  const account = await WhatsAppAccount.findOne({ _id: phoneNumber.whatsappAccountId, tenantId }).select(
    '+accessTokenRef +accessTokenEnc',
  );
  if (!account) {
    throw ApiError.notFound('WHATSAPP_ACCOUNT_NOT_FOUND', 'WhatsApp account not found');
  }
  if (account.status !== 'CONNECTED') {
    throw ApiError.badRequest('WHATSAPP_ACCOUNT_NOT_CONNECTED', 'This WhatsApp account is not connected');
  }

  return {
    accessToken: await resolveAccountAccessToken(account),
    phoneNumberId: phoneNumber.phoneNumberId,
    // Returned so the send path can mark this exact connection EXPIRED when
    // Meta rejects the token, rather than having to look it up again from
    // an error that carries no account context.
    whatsappAccountId: String(account._id),
  };
}

export async function resolveWabaCredentialsForTenant(
  tenantId: string,
  whatsappAccountId: string,
): Promise<{ accessToken: string; wabaId: string }> {
  if (!Types.ObjectId.isValid(whatsappAccountId)) {
    throw ApiError.notFound('WHATSAPP_ACCOUNT_NOT_FOUND', 'WhatsApp account not found');
  }
  const account = await WhatsAppAccount.findOne({ _id: whatsappAccountId, tenantId }).select('+accessTokenRef +accessTokenEnc');
  if (!account) {
    throw ApiError.notFound('WHATSAPP_ACCOUNT_NOT_FOUND', 'WhatsApp account not found');
  }
  return { accessToken: await resolveAccountAccessToken(account), wabaId: account.wabaId };
}

export interface PublicWhatsAppNumber {
  id: string;
  /** Meta's own phone_number_id. Safe to show: it is an account identifier,
   *  not a credential — the access token it is used with never leaves the
   *  server (see resolveMetaCredentialsForPhoneNumber above). */
  phoneNumberId: string;
  displayPhoneNumber: string;
  status: string;
  /**
   * Whether the admin has left this number switched on.
   *
   * Separate from `status`: that is Meta's view of the number, this is
   * the workspace's. A number can be perfectly CONNECTED at Meta and
   * still be switched off here.
   */
  enabled: boolean;
  /**
   * Meta's calling status for this number — 'ENABLED' | 'DISABLED', or
   * absent when it has never been read.
   *
   * Off by default on every number, which is the single most common
   * reason a WhatsApp call never arrives.
   */
  callingStatus?: string;
  qualityRating?: string;
  messagingLimitTier?: string;
  /** When quality and tier were last read from Meta — null if never. */
  healthCheckedAt?: string;
  /**
   * The Business Manager this number answers on, or null for the
   * server's default configuration.
   *
   * Reported because it decides everything else and was invisible: the
   * BM's token is what sends from this number, and its webhook URL is
   * where inbound arrives. A number under the wrong one sends fine and
   * never receives, and nothing on the screen said which it was under.
   */
  metaAppId?: string | null;
  metaAppName?: string | null;
  /**
   * The rating turned into something actionable. Computed here rather than
   * in each client so every surface says the same thing about the same
   * number.
   */
  health: NumberHealth;
}

/** Exported for its test: `enabled` defaulting wrong locks out a workspace. */
export function toPublicWhatsAppNumber(
  n: WhatsAppPhoneNumberDoc,
  app?: { id: string; name: string } | null,
): PublicWhatsAppNumber {
  return {
    metaAppId: app?.id ?? null,
    metaAppName: app?.name ?? null,
    id: String(n._id),
    phoneNumberId: n.phoneNumberId,
    displayPhoneNumber: n.displayPhoneNumber,
    status: n.status,
    // Absent on every document written before the field existed, and
    // absent has to mean ON — a migration that silently locked out every
    // existing member would be the worst possible reading of it.
    enabled: n.enabled !== false,
    callingStatus: n.callingStatus ?? undefined,
    qualityRating: n.qualityRating ?? undefined,
    messagingLimitTier: n.messagingLimitTier ?? undefined,
    healthCheckedAt: n.healthCheckedAt ? n.healthCheckedAt.toISOString() : undefined,
    health: describeNumberHealth({
      qualityRating: n.qualityRating ?? undefined,
      messagingLimitTier: n.messagingLimitTier ?? undefined,
      healthCheckedAt: n.healthCheckedAt ?? undefined,
    }),
  };
}

/**
 * How old a health reading may be before it is refetched.
 *
 * Meta moves a rating over hours, not seconds, so this is about being
 * usefully current rather than live — and about not spending a Graph call
 * every time the settings screen is opened.
 */
const HEALTH_STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * Re-reads one number's quality rating and messaging tier from Meta.
 *
 * Never throws. This runs behind a list request the user is waiting on,
 * and a Graph hiccup must not turn "here are your numbers" into an error —
 * the stored values are still shown, just older.
 */
export async function refreshNumberHealth(number: WhatsAppPhoneNumberDoc): Promise<void> {
  try {
    const credentials = await resolveMetaCredentialsForPhoneNumber(
      String(number.tenantId),
      String(number._id),
    );
    const profile = await getMetaGateway().fetchPhoneNumberProfile(
      credentials.accessToken,
      number.phoneNumberId,
    );

    number.qualityRating = profile.qualityRating;
    number.messagingLimitTier = profile.messagingLimitTier;
    number.nameStatus = profile.nameStatus;
    // The name the customer already sees above this number in WhatsApp.
    // Only overwritten when Meta actually returns one: a blank reply must
    // not erase a name we already have, or the web window would fall back
    // to the workspace's internal label on a single bad Graph response.
    if (profile.verifiedName) number.verifiedName = profile.verifiedName;

    // Calling lives behind its own Graph call, and it is off by default on
    // every number — so without reading it the admin screen cannot tell a
    // number that will ring from one that silently never can.
    // Never allowed to fail the refresh: the rating is the more important
    // half, and an older calling status beats no health reading at all.
    try {
      const calling = await getMetaGateway().getCallingSettings(
        credentials.accessToken,
        number.phoneNumberId,
      );
      if (calling.status) number.callingStatus = calling.status;
    } catch (err) {
      logger.warn({ err, phoneNumberId: number.phoneNumberId }, 'Could not read calling settings');
    }
    number.codeVerificationStatus = profile.codeVerificationStatus;
    number.healthCheckedAt = new Date();
    await number.save();
  } catch (err) {
    logger.warn({ err, phoneNumberId: number.phoneNumberId }, 'Could not refresh WhatsApp number health');
  }
}

/**
 * Refreshes one number's health only if the stored reading has aged out.
 *
 * The staleness test used to live inside listPhoneNumbersForTenant, which
 * meant every other caller that wanted a current reading had to remember
 * to repeat it — or, as the guest window did, silently render a field
 * nothing was keeping current. Named here so "refresh if it is old" is
 * one call rather than a rule each caller reimplements.
 *
 * Never throws, and never awaited by the paths that use it: the stored
 * values are what gets rendered this time round either way.
 */
export async function refreshNumberHealthIfStale(number: WhatsAppPhoneNumberDoc): Promise<void> {
  const checkedAt = number.healthCheckedAt?.getTime() ?? 0;
  if (checkedAt >= Date.now() - HEALTH_STALE_AFTER_MS) return;
  await refreshNumberHealth(number);
}

/**
 * The tenant's WhatsApp numbers, for the admin's "sends from" picker and
 * the health screen.
 *
 * Stale readings are refreshed in the background rather than awaited: the
 * caller gets the stored values immediately and the next open shows the
 * new ones. Blocking this on a Graph round trip per number would make the
 * screen as slow as Meta happens to be that minute, for a rating that
 * moves over hours.
 */
export async function listPhoneNumbersForTenant(tenantId: string): Promise<PublicWhatsAppNumber[]> {
  const numbers = await findPhoneNumbersByTenant(tenantId);

  for (const number of numbers) void refreshNumberHealthIfStale(number);

  // Two queries for the whole list rather than two per number: a number
  // points at an account and the account names the Business Manager, and
  // doing that per row is a pair of round trips each against a database
  // that is not local.
  const appOfNumber = await resolveBusinessManagerOfNumbers(tenantId, numbers);
  return numbers.map((n) => toPublicWhatsAppNumber(n, appOfNumber.get(String(n.whatsappAccountId)) ?? null));
}

/** account id → the Business Manager it belongs to, for a tenant's numbers. */
async function resolveBusinessManagerOfNumbers(
  tenantId: string,
  numbers: WhatsAppPhoneNumberDoc[],
): Promise<Map<string, { id: string; name: string } | null>> {
  const accountIds = [...new Set(numbers.map((n) => String(n.whatsappAccountId)))];
  if (accountIds.length === 0) return new Map();

  const accounts = await WhatsAppAccount.find({ _id: { $in: accountIds }, tenantId })
    .select('metaAppId')
    .lean();
  const appIds = [...new Set(accounts.map((a) => a.metaAppId).filter(Boolean).map(String))];
  const apps = appIds.length > 0 ? await MetaApp.find({ _id: { $in: appIds }, tenantId }).select('name').lean() : [];
  const nameOfApp = new Map(apps.map((a) => [String(a._id), a.name]));

  return new Map(
    accounts.map((a) => {
      const appId = a.metaAppId ? String(a.metaAppId) : null;
      const name = appId ? nameOfApp.get(appId) : undefined;
      return [String(a._id), appId && name ? { id: appId, name } : null];
    }),
  );
}

/**
 * Move a number onto a different Business Manager.
 *
 * The case this exists for: a number added under one BM that has to end up
 * under another — a workspace splitting numbers across BMs to stay under
 * Meta's per-BM cap, or a BM being retired.
 *
 * Verified against Meta BEFORE anything is written, and that is the whole
 * value of the endpoint. A token from BM 1 cannot see a number in BM 2, so
 * a move done blindly leaves a row that looks perfectly configured and a
 * number that sends nothing — which is exactly the failure this module's
 * account scoping was introduced to prevent. If the target BM's token
 * cannot read the number's profile, the move is refused and Meta's own
 * reason is passed through.
 *
 * The number is repointed at an account under the target BM rather than
 * the account's own metaAppId being rewritten: an account can carry
 * several numbers, and moving one must not silently move its siblings.
 */
export async function moveNumberToBusinessManager(
  tenantId: string,
  numberId: string,
  metaAppId: string | null,
): Promise<PublicWhatsAppNumber> {
  const number = await findPhoneNumberByIdAndTenant(numberId, tenantId);
  if (!number) throw ApiError.notFound('WHATSAPP_NUMBER_NOT_FOUND', 'That number is not in this workspace.');

  let metaApp = null;
  if (metaAppId) {
    metaApp = await findMetaAppByIdAndTenant(metaAppId, tenantId);
    if (!metaApp) {
      throw ApiError.badRequest('META_APP_NOT_FOUND', 'That Business Manager does not belong to this workspace.');
    }
    if (metaApp.status !== 'ACTIVE') {
      throw ApiError.badRequest('META_APP_DISABLED', `"${metaApp.name}" is disabled, so numbers cannot be moved onto it.`);
    }
  }

  const accessToken = metaApp
    ? (readAppSecret(metaApp.accessTokenEnc) ??
      (() => {
        throw ApiError.badRequest(
          'META_APP_TOKEN_MISSING',
          `"${metaApp.name}" has no access token saved, so it cannot claim this number. Add one first.`,
        );
      })())
    : resolveAccessToken(undefined);

  // The check that makes this safe. Meta answering for this number under
  // the target token is the only proof the move will actually work.
  let profile;
  try {
    profile = await getMetaGateway().fetchPhoneNumberProfile(accessToken, number.phoneNumberId);
  } catch (err) {
    throw ApiError.badRequest(
      'WHATSAPP_NUMBER_VERIFICATION_FAILED',
      `${metaApp ? `"${metaApp.name}"` : 'The server’s default configuration'} cannot see this number at Meta: ` +
        `${err instanceof Error ? err.message : 'unknown error'}. Check that the Business Manager owns it and that ` +
        'its System User has the WhatsApp account assigned as an asset.',
    );
  }

  const currentAccount = await WhatsAppAccount.findOne({ _id: number.whatsappAccountId, tenantId })
    .select('wabaId')
    .lean();
  const account = await findOrCreateRealAccount(
    tenantId,
    currentAccount?.wabaId,
    metaApp ? String(metaApp._id) : undefined,
  );

  number.whatsappAccountId = account._id;
  number.displayPhoneNumber = profile.displayPhoneNumber;
  number.qualityRating = profile.qualityRating;
  if (profile.verifiedName) number.verifiedName = profile.verifiedName;
  await number.save();

  return toPublicWhatsAppNumber(number, metaApp ? { id: String(metaApp._id), name: metaApp.name } : null);
}

/**
 * Switching WhatsApp voice calling on for a number.
 *
 * This is the step nothing else does. Calling is OFF by default on every
 * number Meta issues — including test numbers — so an app with the whole
 * calling path built end to end still never rings, and no status on the
 * number says why. Every other piece was already here: the `calls`
 * webhook is parsed, an inbound call creates a log, rings the agent's
 * socket and pushes to their phone. Only the switch was missing.
 *
 * Meta's answer is read back afterwards rather than assumed. Writing
 * 'ENABLED' locally because the POST returned 200 would put a state on
 * the admin screen that Meta had not confirmed, and the whole point of
 * showing it is to answer "why is this not ringing?".
 *
 * TWO THINGS still have to be true for a call to arrive, and neither is
 * ours to set: the Meta app must subscribe to the `calls` webhook field,
 * and the number's WABA must be subscribed to the app. The message path
 * needs the second one too, so a workspace whose messages work already
 * has it — the webhook FIELD is the one people miss.
 */
export async function setCallingEnabled(
  tenantId: string,
  numberId: string,
  enabled: boolean,
): Promise<PublicWhatsAppNumber> {
  const number = await findPhoneNumberByIdAndTenant(numberId, tenantId);
  if (!number) {
    throw ApiError.notFound('WHATSAPP_NUMBER_NOT_FOUND', 'That number is not registered to this workspace.');
  }

  const credentials = await resolveMetaCredentialsForPhoneNumber(tenantId, numberId);
  const gateway = getMetaGateway();

  try {
    await gateway.setCallingEnabled(credentials.accessToken, number.phoneNumberId, enabled);
  } catch (err) {
    // Meta's own message is the useful part — "calling not available in
    // this country", a permissions error on the token. Passing it through
    // is what makes this endpoint worth calling.
    throw ApiError.badRequest(
      'WHATSAPP_CALLING_UPDATE_FAILED',
      `Meta refused that: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }

  try {
    const calling = await gateway.getCallingSettings(credentials.accessToken, number.phoneNumberId);
    number.callingStatus = calling.status ?? (enabled ? 'ENABLED' : 'DISABLED');
  } catch {
    // The write succeeded; only the read-back did not. Recording what was
    // asked for beats leaving the field blank, and the next health
    // refresh corrects it either way.
    number.callingStatus = enabled ? 'ENABLED' : 'DISABLED';
  }
  await number.save();

  logger.info(
    { numberId, enabled, callingStatus: number.callingStatus },
    'WhatsApp calling switched by an admin',
  );

  return toPublicWhatsAppNumber(number);
}

/**
 * The admin switching one number on or off.
 *
 * Off means the members assigned to it cannot use the app at all — they
 * are refused at the auth context with NUMBER_ACCESS_DENIED (see
 * authContext.service.ts), which covers reading, sending and the socket
 * in one place rather than in each of them.
 *
 * Inbound messages are deliberately NOT dropped. A customer writing to a
 * number the workspace has switched off has done nothing wrong, and
 * throwing their message away to enforce an internal decision would lose
 * real business. The messages land and wait; what is gated is who may
 * work them.
 *
 * Every affected member's cached auth context is dropped immediately, so
 * the switch takes effect on their next request rather than up to ten
 * seconds later — an admin turning off access should watch it happen.
 */
export async function setNumberEnabled(
  tenantId: string,
  numberId: string,
  enabled: boolean,
): Promise<PublicWhatsAppNumber> {
  const number = await findPhoneNumberByIdAndTenant(numberId, tenantId);
  if (!number) {
    throw ApiError.notFound('WHATSAPP_NUMBER_NOT_FOUND', 'That number is not registered to this workspace.');
  }

  number.enabled = enabled;
  await number.save();

  const affected = await User.find({ tenantId, whatsappPhoneNumberId: numberId }).select('_id').lean();
  for (const u of affected) invalidateAuthContext(String(u._id), tenantId);

  logger.info(
    { numberId, enabled, affectedUsers: affected.length },
    'WhatsApp number access switched by an admin',
  );

  return toPublicWhatsAppNumber(number);
}

/**
 * Registers a real WhatsApp number on this tenant, replacing the demo
 * placeholder the seed writes.
 *
 * This exists because a fresh deployment ships with `DEMO-PHONE-000001`,
 * which is not a Meta id at all: every send against it fails, and nothing
 * short of hand-editing Mongo could change it. The id is verified with Meta
 * before it is stored, so a typo fails here — naming the problem — instead
 * of at 3am inside a send.
 */
/**
 * Registers an already-stored number for Cloud API use.
 *
 * Adding a number in WhatsApp Manager and pasting its id here is not
 * enough: until POST /{id}/register runs, Meta leaves the number
 * "Pending" and every send fails with a "not registered" error. The
 * Embedded Signup path has always done this; the admin path never did,
 * which is why a hand-registered number could look correctly configured
 * and still be unable to send.
 *
 * Meta's own error text is passed through. "Already registered" is not
 * treated as a failure — re-running this is how you recover from a partial
 * setup, and it has to be safe to repeat.
 */
export async function registerNumberForCloudApi(
  tenantId: string,
  numberId: string,
): Promise<{ registered: boolean; message: string }> {
  if (!env.META_REGISTER_PIN) {
    throw ApiError.badRequest(
      'REGISTER_PIN_MISSING',
      'META_REGISTER_PIN is not set on the server. Choose any six digits, set it, and keep it the same ' +
        'from then on — it is the number\'s two-step verification PIN, and changing it breaks re-registration.',
    );
  }

  const number = await findPhoneNumberByIdAndTenant(numberId, tenantId);
  if (!number) {
    throw ApiError.notFound('WHATSAPP_NUMBER_NOT_FOUND', 'That number is not registered to this workspace.');
  }

  const credentials = await resolveMetaCredentialsForPhoneNumber(tenantId, numberId);

  // The step the manual path always skipped, and the reason a
  // hand-registered number could look perfectly configured and still
  // receive nothing.
  //
  // There are two subscriptions and only one of them is in the app
  // dashboard. Ticking `messages` under Webhook fields says "this app
  // wants message events"; this says "THIS WhatsApp Business Account
  // sends its events to that app". Without both, Meta has an app
  // listening for messages from no accounts at all — a verified callback
  // URL that is never called.
  //
  // Embedded Signup has always done this (see embeddedSignup.service.ts).
  // Doing it here too means the two paths end in the same state instead
  // of one of them ending in silence.
  const account = await WhatsAppAccount.findById(number.whatsappAccountId).select('wabaId').lean();
  let subscribed = false;
  /**
   * What to say about the subscription, when there is something to say.
   *
   * Silence here was a real trap. Subscribing the WhatsApp account to the
   * app is what makes Meta DELIVER anything; without it a number
   * registers, reports CONNECTED, sends perfectly, and never receives a
   * single message. And the step is skipped whenever the WABA id is
   * missing — a field the form calls optional — with nothing anywhere
   * saying so. Everything looked configured and inbound simply never
   * started.
   */
  let subscriptionNote = '';
  if (account?.wabaId) {
    try {
      await subscribeAppToWaba(credentials.accessToken, account.wabaId);
      subscribed = true;
    } catch (err) {
      // Not fatal: the number may already be subscribed, or the token may
      // lack whatsapp_business_management while still being able to send.
      // Registration below is the more important half, and saying so in
      // the result beats failing the whole call.
      logger.warn({ err, wabaId: account.wabaId }, 'subscribed_apps failed during manual registration');
      subscriptionNote =
        ' Meta refused to subscribe this WhatsApp account to your app, so INBOUND MESSAGES WILL NOT ARRIVE. ' +
        'Usually the access token is missing whatsapp_business_management, or the System User does not have ' +
        'the WhatsApp account assigned as an asset.';
    }
  } else {
    logger.warn(
      { numberId: String(number._id), accountId: String(number.whatsappAccountId) },
      'No WABA id on this account, so the app was not subscribed — inbound will not arrive',
    );
    subscriptionNote =
      ' No WhatsApp Business Account ID is set for this number, so it was NOT subscribed to your app — ' +
      'INBOUND MESSAGES WILL NOT ARRIVE. Add the WABA ID and register again.';
  }

  try {
    await registerPhoneNumber(credentials.accessToken, number.phoneNumberId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    // Meta says this when the number is already usable. Reporting it as a
    // failure would send an admin looking for a problem they do not have.
    if (/already registered/i.test(message)) {
      return {
        registered: true,
        message: `This number was already registered for the Cloud API.${
          subscribed ? ' Its WhatsApp account is now subscribed to your app.' : subscriptionNote
        }`,
      };
    }

    // A PIN mismatch on a number that is already CONNECTED is not a
    // failure worth alarming anyone with. Meta's #133005 means the PIN we
    // sent is not the number's two-step verification PIN — but this call
    // only exists to move a number from Pending to Connected, and one
    // that is already Connected does not need it. Reporting it in red
    // sends an admin looking for a problem that is not blocking anything.
    //
    // Said plainly rather than swallowed, because it WILL block the next
    // number added to this workspace, and the fix is a two-minute change
    // in WhatsApp Manager rather than a mystery in six weeks.
    if (/133005/.test(message) && number.status === 'CONNECTED') {
      return {
        registered: true,
        message:
          'Already connected, so no registration was needed. Meta did reject the PIN — this number ' +
          'has a different two-step verification PIN than META_REGISTER_PIN. Nothing is broken now, ' +
          'but align them before adding another number.' +
          (subscribed ? ' Its WhatsApp account is now subscribed to your app.' : subscriptionNote),
      };
    }
    throw ApiError.badRequest('WHATSAPP_REGISTER_FAILED', `Meta refused the registration: ${message}`);
  }

  // Meta reports the new state a moment later, so this is read rather than
  // assumed — the point of the screen is to show what Meta thinks, not
  // what we hoped.
  await refreshNumberHealth(number);
  return {
    registered: true,
    message: subscribed
      ? 'Registered, and this WhatsApp account now sends its messages to your app. It may take a minute to leave "Pending".'
      : `Registered for the Cloud API. It may take a minute to leave "Pending".${subscriptionNote}`,
  };
}

export async function registerPhoneNumberForTenant(
  tenantId: string,
  phoneNumberId: string,
  wabaId?: string,
  /**
   * Which Business Manager this number belongs to.
   *
   * Omitted means the single-BM setup this grew out of: the global
   * META_ACCESS_TOKEN verifies the number and the tenant's one account
   * holds it. Given, the number is verified with THAT BM's token — using
   * the global one would fail with a permissions error naming nothing
   * useful, because a token from BM 1 cannot see a number in BM 2.
   */
  metaAppId?: string,
): Promise<PublicWhatsAppNumber> {
  let metaApp = null;
  if (metaAppId) {
    metaApp = await findMetaAppByIdAndTenant(metaAppId, tenantId);
    if (!metaApp) {
      throw ApiError.badRequest('META_APP_NOT_FOUND', 'That Business Manager does not belong to this workspace.');
    }
  }

  const accessToken = metaApp
    ? (readAppSecret(metaApp.accessTokenEnc) ??
      (() => {
        throw ApiError.badRequest(
          'META_APP_TOKEN_MISSING',
          `"${metaApp.name}" has no access token saved, so its numbers cannot be verified. Add one first.`,
        );
      })())
    : resolveAccessToken(undefined); // env token; the account row may still hold the placeholder

  let profile;
  try {
    profile = await getMetaGateway().fetchPhoneNumberProfile(accessToken, phoneNumberId);
  } catch (err) {
    // Meta's own message is the useful part here — "Unsupported get request"
    // for a wrong id, "Invalid OAuth access token" for a bad token. Passing
    // it through is what makes this endpoint worth calling.
    throw ApiError.badRequest(
      'WHATSAPP_NUMBER_VERIFICATION_FAILED',
      `Meta rejected this phone number id: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }

  // Another tenant already owns it — phoneNumberId is globally unique
  // because it is the only key an inbound webhook carries, so two tenants
  // sharing one would make inbound routing ambiguous.
  const existingAnywhere = await WhatsAppPhoneNumber.findOne({ phoneNumberId });
  if (existingAnywhere && String(existingAnywhere.tenantId) !== tenantId) {
    throw ApiError.conflict(
      'WHATSAPP_NUMBER_ALREADY_REGISTERED',
      'That WhatsApp number is already registered to another workspace.',
    );
  }

  const account = await findOrCreateRealAccount(tenantId, wabaId, metaApp ? String(metaApp._id) : undefined);

  if (existingAnywhere) {
    existingAnywhere.displayPhoneNumber = profile.displayPhoneNumber;
    existingAnywhere.qualityRating = profile.qualityRating;
    if (profile.verifiedName) existingAnywhere.verifiedName = profile.verifiedName;
    existingAnywhere.status = 'CONNECTED';
    existingAnywhere.whatsappAccountId = account._id;
    await existingAnywhere.save();
    return toPublicWhatsAppNumber(existingAnywhere);
  }

  const created = await WhatsAppPhoneNumber.create({
    tenantId,
    whatsappAccountId: account._id,
    phoneNumberId: profile.phoneNumberId,
    displayPhoneNumber: profile.displayPhoneNumber,
    qualityRating: profile.qualityRating,
    verifiedName: profile.verifiedName,
    status: 'CONNECTED',
  });
  return toPublicWhatsAppNumber(created);
}

/**
 * Which accounts belong to a given Business Manager.
 *
 * Two cases, and the second is the one that had to be got right. With a
 * BM named, match only its accounts. WITHOUT one — the existing single-BM
 * deployment — match only accounts that have no BM at all, because an
 * unfiltered query would hand back whichever account happened to be
 * oldest, including one belonging to a Business Manager whose token
 * cannot send from this number.
 *
 * `$exists: false` rather than `null`: the field was added after these
 * documents were written, so it is absent from every one of them, and
 * `{ metaAppId: null }` would match those too but also anything later
 * written with an explicit null. Absent is the honest description.
 *
 * Exported for its test: a mistake here does not throw, it attaches a
 * number to the wrong credentials and fails at Meta days later.
 */
export function accountScopeFilter(metaAppId?: string): Record<string, unknown> {
  return metaAppId ? { metaAppId } : { metaAppId: { $exists: false } };
}

/**
 * The WhatsAppAccount to hang a newly registered number off.
 *
 * Scoped to the Business Manager, which is the part that changed when a
 * workspace stopped being one BM. Previously this reused the tenant's one
 * account for everything; a number from a second BM hung off it would then
 * be sent with the FIRST BM's token, and fail — quietly, since the row
 * looks perfectly configured either way.
 *
 * Within one BM the old behaviour is unchanged and still deliberate: reuse
 * the existing account, including the seeded demo one upgraded in place
 * with the real WABA id, rather than creating a second. Two accounts for
 * one BM would make template sync ambiguous, and the demo row is otherwise
 * dead weight nothing ever cleans up.
 */
async function findOrCreateRealAccount(
  tenantId: string,
  wabaId?: string,
  metaAppId?: string,
): Promise<WhatsAppAccountDoc> {
  const existing = await WhatsAppAccount.findOne({
    tenantId,
    ...accountScopeFilter(metaAppId),
  }).sort({ createdAt: 1 });
  if (existing) {
    if (wabaId && existing.wabaId !== wabaId) {
      existing.wabaId = wabaId;
      existing.status = 'CONNECTED';
      existing.connectedAt = existing.connectedAt ?? new Date();
      await existing.save();
    }
    return existing;
  }
  return WhatsAppAccount.create({
    tenantId,
    metaAppId,
    wabaId: wabaId ?? `PENDING-WABA-${tenantId}`,
    accessTokenRef: 'env:META_ACCESS_TOKEN', // resolveAccessToken() defers to the environment
    verifyToken: env.META_VERIFY_TOKEN || 'unset',
    status: 'CONNECTED',
    connectedAt: new Date(),
  });
}
