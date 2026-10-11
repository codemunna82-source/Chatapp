import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';
import SmsAndroid from 'react-native-get-sms-android';
import { recordSmsSent } from '../storage/smsSendTracker';

function openSmsComposer(phone: string, body: string) {
  // iOS and Android disagree on how an sms: URL takes a prefilled body.
  const separator = Platform.OS === 'ios' ? '&' : '?';
  void Linking.openURL(`sms:${phone}${separator}body=${encodeURIComponent(body)}`);
}

/**
 * Sends an SMS straight off the device's own SIM on Android — no
 * composer, no manual tap to send — via react-native-get-sms-android's
 * autoSend. Falls back to opening the native SMS composer on iOS (Apple
 * gives no app a way to send SMS on the user's behalf at all), if the
 * SEND_SMS permission is denied, or if the send itself fails.
 */
export async function sendSmsAutomatically(phone: string, body: string): Promise<void> {
  if (Platform.OS !== 'android') {
    openSmsComposer(phone, body);
    return;
  }

  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS, {
    title: 'Send SMS',
    message: "VOXO sends this text straight from this phone's SIM, so you don't have to open the SMS app and tap send yourself.",
    buttonPositive: 'Allow',
  });
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    openSmsComposer(phone, body);
    return;
  }

  SmsAndroid.autoSend(
    phone,
    body,
    () => {
      Alert.alert('Could not send automatically', 'Opening the SMS app so you can send it yourself.');
      openSmsComposer(phone, body);
    },
    () => {
      recordSmsSent();
    },
  );
}
