import { useEffect } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { storage } from '../storage/mmkv';
import { queryKeys } from '../queries/keys';
import {
  getSmsPermissionStatus,
  getUndeliveredSms,
  importSmsHistory,
  markSmsDelivered,
  requestSmsPermissions,
  smsStoreAvailable,
  subscribeToNewSms,
  type StoredSms,
} from '../native/smsStore';

const ASKED_KEY = 'voxo.localSms.permissionAsked';
const LAST_IMPORT_KEY = 'voxo.localSms.lastImportAt';
/** First run: how much existing history to copy in, per box (inbox and sent). */
const FIRST_IMPORT_PER_BOX = 3000;
const INCREMENTAL_PER_BOX = 1000;
/**
 * Incremental imports re-read a little before the last one, so a message
 * whose provider date is slightly older than the import that missed it is
 * still picked up. Duplicates are dropped by the store itself.
 */
const IMPORT_OVERLAP_MS = 6 * 60 * 60 * 1000;

let syncing: Promise<void> | null = null;
let syncNow: (() => void) | null = null;

/** Runs the import/reload now — e.g. right after SMS permission is granted in Settings. */
export function triggerLocalSmsSync(): void {
  syncNow?.();
}

/**
 * Keeps the on-device SMS store and the UI in step. No network: SMS content
 * never leaves the phone.
 *
 * - Live: while this runtime is alive, the native receiver's event refreshes
 *   the SMS queries the moment a message is stored.
 * - Resume/restart: messages stored while JS was not running (app in the
 *   background, closed, or the process started by the broadcast itself) are
 *   read back as "undelivered" and the queries reloaded.
 * - Recovery: an incremental history import on every open picks up anything
 *   the receiver never saw — Android delivers no broadcasts to a
 *   force-stopped app, and some OEM battery managers suppress them.
 *
 * Mounted once, for signed-in users, next to the other background runners.
 */
export function LocalSmsRunner(): null {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (Platform.OS !== 'android' || !smsStoreAvailable) return;

    const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.localSmsAll });

    const acknowledge = async (rows: StoredSms[]) => {
      if (rows.length === 0) return;
      await refresh();
      await markSmsDelivered(Math.max(...rows.map((r) => r.id)));
    };

    const sync = () => {
      if (syncing) return syncing;
      syncing = (async () => {
        try {
          await syncOnce(acknowledge, refresh);
        } catch {
          // Each step already degrades on its own; a failure here only means
          // the next resume tries again.
        } finally {
          syncing = null;
        }
      })();
      return syncing;
    };

    const unsubscribe = subscribeToNewSms((rows) => {
      void acknowledge(rows).catch(() => {});
    });
    syncNow = () => void sync();
    void sync();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });

    return () => {
      unsubscribe();
      appState.remove();
      syncNow = null;
    };
  }, [queryClient]);

  return null;
}

async function syncOnce(
  acknowledge: (rows: StoredSms[]) => Promise<void>,
  refresh: () => Promise<void>,
): Promise<void> {
  let status = await getSmsPermissionStatus();
  if (!status) return;

  if ((!status.receiveSms || !status.readSms) && !storage.getBoolean(ASKED_KEY)) {
    storage.set(ASKED_KEY, true);
    const result = await requestSmsPermissions();
    if (result === 'blocked') {
      Alert.alert(
        'SMS access is blocked',
        'VOXO cannot show your SMS until it is allowed. Open App info for VOXO (long-press the icon > App info). ' +
          'If you see "Allow restricted settings" in the ⋮ menu, tap it first, then go to Permissions > SMS > Allow.',
      );
    }
    status = await getSmsPermissionStatus();
    if (!status) return;
  }

  // Whatever the receiver stored while this runtime was not listening.
  await acknowledge(await getUndeliveredSms());

  if (!status.readSms) return;
  const startedAt = Date.now();
  const last = storage.getNumber(LAST_IMPORT_KEY) ?? 0;
  const result =
    last > 0
      ? await importSmsHistory(INCREMENTAL_PER_BOX, Math.max(0, last - IMPORT_OVERLAP_MS))
      : await importSmsHistory(FIRST_IMPORT_PER_BOX, 0);
  storage.set(LAST_IMPORT_KEY, startedAt);
  if (result.imported > 0) await refresh();
  await acknowledge(await getUndeliveredSms());
}
