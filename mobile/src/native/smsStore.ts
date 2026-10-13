import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';

/**
 * Typed bridge to VoxoSmsStoreModule.kt — the on-device SQLite store every
 * incoming SMS is written to by SmsStoreReceiver, with or without this JS
 * runtime alive. Nothing here sends SMS content anywhere off the phone.
 *
 * Android only. On iOS (no API to read SMS) every read returns empty.
 */
export interface StoredSms {
  id: number;
  /** Normalised sender: all spellings of one number share it. Opaque to JS. */
  threadKey: string;
  address: string;
  body: string;
  /** Original send time (service-centre time for incoming), epoch ms. */
  timestamp: number;
  /** When this phone stored it, epoch ms. */
  receivedAt: number;
  direction: 'IN' | 'OUT';
  /** SENDING until the radio answers; FAILED when the network refused it. */
  status: 'RECEIVED' | 'SENDING' | 'SENT' | 'FAILED';
  /** -1 when the device did not say which SIM. */
  subscriptionId: number;
  simSlot: number;
  source: 'broadcast' | 'import' | 'voxo';
  read: boolean;
}

export interface StoredSmsThread extends StoredSms {
  unreadCount: number;
}

export interface SmsPermissionStatus {
  receiveSms: boolean;
  readSms: boolean;
  sendSms: boolean;
  /** Needed on dual-SIM phones set to "ask every time", to pick a SIM to send from. */
  readPhoneState: boolean;
  isDefaultSmsApp: boolean;
  ignoringBatteryOptimizations: boolean;
  sdkInt: number;
  manufacturer: string;
  model: string;
}

export interface SmsStoreDiagnostics {
  storedMessages: number;
  parkedMessages: number;
  lastBroadcastAt: number;
  broadcastCount: number;
  storedFromBroadcasts: number;
  duplicateBroadcasts: number;
  lastImportAt: number;
  lastError: string | null;
  lastErrorAt: number;
}

interface VoxoSmsStoreNative {
  getPermissionStatus(): Promise<SmsPermissionStatus>;
  getThreads(limit: number): Promise<StoredSmsThread[]>;
  getMessages(address: string, limit: number, beforeTimestamp: number): Promise<StoredSms[]>;
  markThreadRead(address: string): Promise<number>;
  deleteThread(address: string): Promise<number>;
  deleteMessage(id: number): Promise<number>;
  getUndelivered(limit: number): Promise<StoredSms[]>;
  markDelivered(upToId: number): Promise<boolean>;
  importHistory(maxPerBox: number, sinceMs: number): Promise<{ scanned: number; imported: number }>;
  getDiagnostics(): Promise<SmsStoreDiagnostics>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const native: VoxoSmsStoreNative | undefined =
  Platform.OS === 'android' ? (NativeModules.VoxoSmsStore as VoxoSmsStoreNative | undefined) : undefined;

export const smsStoreAvailable = Boolean(native);

const EVENT_RECEIVED = 'VoxoSmsReceived';

export async function getSmsPermissionStatus(): Promise<SmsPermissionStatus | null> {
  return native ? native.getPermissionStatus() : null;
}

export type SmsPermissionResult = 'granted' | 'denied' | 'blocked';

/**
 * Asks for RECEIVE_SMS, READ_SMS and SEND_SMS together.
 *
 * 'blocked' is "never ask again" — or, on Android 13+ for an APK installed
 * outside an app store, "Restricted settings": the system refuses the dialog
 * until the user allows restricted settings from VOXO's App info screen.
 * Both look identical from here, so the caller explains both.
 */
export async function requestSmsPermissions(): Promise<SmsPermissionResult> {
  if (Platform.OS !== 'android') return 'denied';
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    PermissionsAndroid.PERMISSIONS.READ_SMS,
    PermissionsAndroid.PERMISSIONS.SEND_SMS,
  ]);
  const values = Object.values(result);
  if (values.every((v) => v === PermissionsAndroid.RESULTS.GRANTED)) return 'granted';
  if (values.some((v) => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) return 'blocked';
  return 'denied';
}

export async function getSmsThreads(limit = 500): Promise<StoredSmsThread[]> {
  return native ? native.getThreads(limit) : [];
}

export async function getSmsMessages(address: string, limit = 200, beforeTimestamp = 0): Promise<StoredSms[]> {
  return native ? native.getMessages(address, limit, beforeTimestamp) : [];
}

export async function markSmsThreadRead(address: string): Promise<void> {
  if (native) await native.markThreadRead(address);
}

/** Removes the thread from VOXO only; the phone's Messages app keeps it. */
export async function deleteSmsThread(address: string): Promise<void> {
  if (native) await native.deleteThread(address);
}

/** Removes one message (a failed send being retried) from VOXO only. */
export async function deleteSmsMessage(id: number): Promise<void> {
  if (native) await native.deleteMessage(id);
}

export async function getUndeliveredSms(limit = 500): Promise<StoredSms[]> {
  return native ? native.getUndelivered(limit) : [];
}

export async function markSmsDelivered(upToId: number): Promise<void> {
  if (native) await native.markDelivered(upToId);
}

/** Copies the phone's SMS history (inbox + sent) into the store; `sinceMs` 0 means newest `maxPerBox` of each box. */
export async function importSmsHistory(maxPerBox: number, sinceMs = 0): Promise<{ scanned: number; imported: number }> {
  return native ? native.importHistory(maxPerBox, sinceMs) : { scanned: 0, imported: 0 };
}

export async function getSmsStoreDiagnostics(): Promise<SmsStoreDiagnostics | null> {
  return native ? native.getDiagnostics() : null;
}

const emitter = native ? new NativeEventEmitter(NativeModules.VoxoSmsStore) : null;

/** Fires while VOXO's JS runtime is alive, as soon as a new SMS is stored. Returns an unsubscribe function. */
export function subscribeToNewSms(listener: (messages: StoredSms[]) => void): () => void {
  if (!emitter) return () => {};
  const sub = emitter.addListener(EVENT_RECEIVED, (payload: { messages?: StoredSms[] }) => {
    listener(payload.messages ?? []);
  });
  return () => sub.remove();
}
