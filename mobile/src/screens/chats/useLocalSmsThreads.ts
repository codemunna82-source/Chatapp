import { useCallback, useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { listInboxSms } from '../../utils/localSmsInbox';
import { matchesLeadKeywords } from '../../utils/smsLeadMatch';

export interface LocalSmsMessage {
  id: number;
  body: string;
  date: number;
}

export interface LocalSmsThread {
  /** The sender's number, exactly as the SMS provider gave it — also what a reply is addressed to. */
  phone: string;
  messages: LocalSmsMessage[];
}

/**
 * Lead SMS threads, grouped by sender, from the device's own inbox — the
 * same keyword-matched set Settings > SMS already reads, regrouped so the
 * Chats tab can show one row per sender (like a conversation) instead of
 * one row per text.
 *
 * Android only, and entirely local: nothing here is a backend
 * conversation, so there is no history once the device changes and
 * nothing for a teammate on another phone to see — see the "device only"
 * choice this was built for.
 */
export function useLocalSmsThreads(): { threads: LocalSmsThread[]; granted: boolean } {
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
      void listInboxSms()
        .then((raw) => {
          const bySender = new Map<string, LocalSmsMessage[]>();
          for (const sms of raw) {
            if (!matchesLeadKeywords(sms.body)) continue;
            const list = bySender.get(sms.address) ?? [];
            list.push({ id: sms._id, body: sms.body, date: sms.date });
            bySender.set(sms.address, list);
          }
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

  return { threads, granted };
}
