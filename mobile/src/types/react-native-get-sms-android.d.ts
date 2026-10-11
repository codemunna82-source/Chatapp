/**
 * No types shipped with the package — this declares only the one function
 * SmsInboxScreen actually calls, not the library's full (Android-only)
 * surface.
 */
declare module 'react-native-get-sms-android' {
  export interface SmsListFilter {
    box?: 'inbox' | 'sent' | 'draft' | 'outbox' | 'failed' | 'queued' | '';
    minDate?: number;
    maxDate?: number;
    indexFrom?: number;
    maxCount?: number;
  }

  export interface RawSmsMessage {
    _id: number;
    thread_id: number;
    address: string;
    date: number;
    body: string;
  }

  const SmsAndroid: {
    list(
      filter: string,
      onFail: (error: string) => void,
      onSuccess: (count: number, smsList: string) => void,
    ): void;
  };
  export default SmsAndroid;
}
