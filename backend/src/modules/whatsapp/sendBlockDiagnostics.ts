import { logger } from '../../lib/logger';
import { fetchNumberHealthStatus } from '../../integrations/meta/phoneNumbers';
import { findPhoneNumberByMetaId } from './whatsapp.repository';
import { resolveMetaCredentialsForPhoneNumber } from './whatsapp.service';

/**
 * When Meta refuses to deliver, ask Meta why — once, and in its own words.
 *
 * A delivery failure arrives as a code and a title: "131031, Business
 * Account locked". That names the symptom and nothing else. It does not
 * say WHICH account is locked — the number's, the WhatsApp Business
 * Account's, or the business portfolio's — and it does not say what would
 * unlock it. Meanwhile the number's own profile reads back CONNECTED with
 * a High quality rating, so the dashboard shows nothing wrong, and the
 * only honest answer anyone can give is "open a support ticket".
 *
 * Meta's `health_status` answers exactly that question, for all three
 * levels at once, with a reason and a suggested remedy per entity. It is
 * just never fetched, because nothing in the ordinary flow has a reason
 * to ask. A refused delivery is that reason.
 *
 * Logged rather than stored or surfaced, deliberately. This is a
 * diagnostic for whoever is reading the logs during an outage, not a new
 * field for the app to render — and a block that needs a human at Meta to
 * clear it is not made better by putting it on an agent's screen.
 */

/** How long one number's answer stands before it is worth asking again. */
const THROTTLE_MS = 10 * 60 * 1000;

const lastAskedAt = new Map<string, number>();

/**
 * Whether enough time has passed to ask Meta about this number again.
 *
 * Exported for its test, and separate from the fetch so the rule can be
 * checked without a network call. A failing send usually fails in bursts —
 * the agent taps retry, the outbox replays, a queue drains — and one Graph
 * call per failed message would turn an outage into a rate limit on top of
 * an outage.
 */
export function shouldAskMeta(key: string, now: number = Date.now()): boolean {
  const previous = lastAskedAt.get(key);
  if (previous !== undefined && now - previous < THROTTLE_MS) return false;
  lastAskedAt.set(key, now);
  return true;
}

/** Test seam. */
export function resetSendBlockDiagnostics(): void {
  lastAskedAt.clear();
}

/**
 * Best-effort: look up why this number cannot deliver, and log it.
 *
 * Never throws and never awaits anything the caller depends on. It runs
 * on the webhook path, where the one unacceptable outcome is a diagnostic
 * that stops a message being processed — the failure it is explaining is
 * already bad enough without losing the next inbound message to it.
 */
export async function logSendBlockDiagnostics(metaPhoneNumberId: string): Promise<void> {
  try {
    if (!shouldAskMeta(metaPhoneNumberId)) return;

    const phoneNumber = await findPhoneNumberByMetaId(metaPhoneNumberId);
    if (!phoneNumber) return;

    const tenantId = String(phoneNumber.tenantId);
    const credentials = await resolveMetaCredentialsForPhoneNumber(tenantId, String(phoneNumber._id));
    const healthStatus = await fetchNumberHealthStatus(credentials.accessToken, credentials.phoneNumberId);

    logger.warn(
      {
        tenantId,
        phoneNumberId: credentials.phoneNumberId,
        displayPhoneNumber: phoneNumber.displayPhoneNumber,
        healthStatus,
      },
      'Meta health_status for the number whose message was refused — this names what is blocked and why',
    );
  } catch (error) {
    // The diagnostic failing is itself worth one line: a token that cannot
    // read health_status is a finding, not a non-event.
    logger.warn({ err: error, metaPhoneNumberId }, 'Could not read Meta health_status for this number');
  }
}
