import { useCallback, useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { listSms } from '../../utils/localSmsInbox';
import { isIndianMobileSender } from '../../utils/smsLeadMatch';

export interface LocalSmsMessage {
  id: number;
  body: string;
  date: number;
  /** True for a message VOXO itself sent — see listSms('sent'). */
  outgoing: boolean;
}

export interface LocalSmsThread {
  /** The sender's number, exactly as the SMS provider gave it — also what a reply is addressed to. */
  phone: string;
  messages: LocalSmsMessage[];
}

/**
 * Lead SMS threads, grouped by sender, from the device's own inbox AND
 * sent box — the same real-mobile-number-filtered set Settings > SMS
 * already reads for the inbox half (see isIndianMobileSender), merged
 * with VOXO's own sends (sendSms in VoxoSmsAutoReplyModule.kt inserts a
 * row into content://sms/sent, the same thing the Messages app itself
 * does) so a reply shows up as a real, persisted message rather than
 * local-only state that vanished the moment this screen unmounted —
 * which used to read as "it sent the first time, then stopped" even
 * though every send had gone out fine the whole time.
 *
 * Android only, and entirely local: nothing here is a backend
 * conversation, so there is no history once the device changes and
 * nothing for a teammate on another phone to see — see the "device only"
 * choice this was built for.
 */
export function useLocalSmsThreads(): { threads: LocalSmsThread[]; granted: boolean; refresh: () => void } {
  const [threads, setThreads] = useState<LocalSmsThread[]>([]);
  const [granted, setGranted] = useState(false);

  const refresh = useCallback(() => {
    if (Platform.OS !== 'android') return;
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS).then((already) => {
      setGranted(already);
      if (!already) {
        setThreads([]);
        return;
      }
      void Promise.all([listSms('inbox'), listSms('sent')])
        .then(([inbox, sent]) => {
          const bySender = new Map<string, LocalSmsMessage[]>();
          const add = (address: string, id: number, body: string, date: number, outgoing: boolean) => {
            if (!isIndianMobileSender(address)) return;
            const list = bySender.get(address) ?? [];
            list.push({ id, body, date, outgoing });
            bySender.set(address, list);
          };
          for (const sms of inbox) add(sms.address, sms._id, sms.body, sms.date, false);
          // A sent row's own "_id" is only unique within its own box — an
          // inbox message and a sent message can share the same id, which
          // would collide as one FlatList/React key if both ever landed in
          // the same thread. Offset keeps them apart without needing to
          // touch every call site that reads LocalSmsMessage.id.
          for (const sms of sent) add(sms.address, sms._id + 10_000_000, sms.body, sms.date, true);
          const grouped = Array.from(bySender.entries()).map(([phone, messages]) => ({
            phone,
            messages: messages.sort((a, b) => b.date - a.date),
          }));
          setThreads(grouped);
        })
        .catch(() => setThreads([]));
    });
  }, []);

  // Covers the common case: the Chats tab is already mounted (tabs freeze
  // rather than unmount) and the agent switches back to it after a text
  // arrived elsewhere.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Covers the screen's own first mount, before any focus event has fired.
  useEffect(() => {
    refresh();
  }, [refresh]);

  return { threads, granted, refresh };
}
