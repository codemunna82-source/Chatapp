import { PermissionsAndroid, Platform } from 'react-native';
import { storage } from '../storage/mmkv';
import { listSms } from './localSmsInbox';
import { isIndianMobileSender } from './smsLeadMatch';
import { syncSms, type SmsSyncItem } from '../api/endpoints/sms';

const SYNCED_IDS_KEY = 'voxo.smsSyncedIds';
/** Caps how many ids this tracks locally — see saveSyncedIds. */
const MAX_TRACKED_IDS = 1000;

/** The device's own SMS row id, turned into this message's permanent identity on the backend — see sms.service.ts's dedup. */
function clientMessageId(box: 'inbox' | 'sent', id: number): string {
  return `android:${box}:${id}`;
}

function last10Digits(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

/**
 * Finds the clientMessageId syncLocalSmsToBackend will use for a text
 * this phone just sent natively (sendSmsNative already inserted it into
 * content://sms/sent before resolving — see VoxoSmsAutoReplyModule.sendSms),
 * so an immediate sync right after sending (ConversationDetailScreen's
 * SMS composer) and the periodic background one that eventually
 * re-scans this same box agree on one identity for the one real text,
 * rather than each minting its own id for it.
 *
 * Matched on the last 10 digits (not the raw string) and the exact
 * body: the content provider's own address format doesn't always match
 * what the composer sent to, and the most recent match is the one that
 * was just sent, not an older text with the same wording.
 */
export async function findSentSmsClientMessageId(phone: string, body: string): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const sent = await listSms('sent');
    const matches = sent
      .filter((sms) => last10Digits(sms.address) === last10Digits(phone) && sms.body === body)
      .sort((a, b) => b.date - a.date);
    return matches.length > 0 ? clientMessageId('sent', matches[0]!._id) : null;
  } catch {
    return null;
  }
}

function getSyncedIds(): Set<string> {
  const raw = storage.getString(SYNCED_IDS_KEY);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveSyncedIds(ids: Set<string>): void {
  // Keep only the most recently added ids — an unbounded set would grow
  // forever on a device that is never uninstalled. Losing an old entry is
  // harmless: the backend's own unique index on clientMessageId is what
  // actually prevents a duplicate; at worst a very old message gets
  // POSTed again and the server recognises and skips it.
  const trimmed = Array.from(ids).slice(-MAX_TRACKED_IDS);
  storage.set(SYNCED_IDS_KEY, JSON.stringify(trimmed));
}

/**
 * Pushes any newly-seen lead SMS (inbox or sent, matching
 * isIndianMobileSender — never an OTP/bank/promo text) to the backend, so
 * it becomes a real, persisted message in the same conversation every
 * signed-in device reads from, rather than something only this one phone
 * ever knew about — see the backend's sms.service.ts.
 *
 * Deliberately filtered the same way the Chats tab already is: syncing
 * every SMS this phone holds, OTPs and bank alerts included, would put a
 * stranger's personal messages into a shared, multi-agent business
 * database — isIndianMobileSender is what keeps this to texts that could
 * plausibly be a customer's.
 *
 * Safe to call repeatedly and often: the backend's own dedup
 * (clientMessageId's unique index) is what actually prevents duplicates;
 * the locally-tracked set here only exists to avoid re-POSTing the same
 * few hundred messages on every poll tick.
 */
export async function syncLocalSmsToBackend(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
    if (!granted) return;

    const [inbox, sent] = await Promise.all([listSms('inbox'), listSms('sent')]);
    const synced = getSyncedIds();

    const candidates: { item: SmsSyncItem; key: string }[] = [];
    for (const sms of inbox) {
      if (!isIndianMobileSender(sms.address)) continue;
      const key = clientMessageId('inbox', sms._id);
      if (synced.has(key)) continue;
      candidates.push({
        item: { phone: sms.address, body: sms.body, date: sms.date, direction: 'IN', clientMessageId: key },
        key,
      });
    }
    for (const sms of sent) {
      if (!isIndianMobileSender(sms.address)) continue;
      const key = clientMessageId('sent', sms._id);
      if (synced.has(key)) continue;
      candidates.push({
        item: { phone: sms.address, body: sms.body, date: sms.date, direction: 'OUT', clientMessageId: key },
        key,
      });
    }

    if (candidates.length === 0) return;

    await syncSms(candidates.map((c) => c.item));
    for (const c of candidates) synced.add(c.key);
    saveSyncedIds(synced);
  } catch {
    // Best-effort — the next poll tick retries with the same candidates,
    // since nothing was marked synced on failure. No UI for this: a sync
    // tick failing silently reads the same as a slow network delaying the
    // next one, not a send that needs the agent's attention — the SMS
    // itself already went out or arrived regardless of whether this sync
    // succeeds.
  }
}
