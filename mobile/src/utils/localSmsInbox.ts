import SmsAndroid, { type RawSmsMessage } from 'react-native-get-sms-android';

export const MAX_SMS_SCANNED = 300;

/** The device's own SMS inbox, newest-scanned-first — read-only, never leaves the device except as a reply. */
export function listInboxSms(): Promise<RawSmsMessage[]> {
  return new Promise((resolve, reject) => {
    SmsAndroid.list(
      JSON.stringify({ box: 'inbox', maxCount: MAX_SMS_SCANNED }),
      (error) => reject(new Error(error)),
      (_count, smsListJson) => {
        try {
          resolve(JSON.parse(smsListJson) as RawSmsMessage[]);
        } catch {
          reject(new Error('Could not read the SMS inbox.'));
        }
      },
    );
  });
}
