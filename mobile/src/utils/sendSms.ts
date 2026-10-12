import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';
import { sendSmsNative } from '../native/smsAutoReply';
import { recordSmsSent } from '../storage/smsSendTracker';

function openSmsComposer(phone: string, body: string) {
  // iOS and Android disagree on how an sms: URL takes a prefilled body.
  const separator = Platform.OS === 'ios' ? '&' : '?';
  void Linking.openURL(`sms:${phone}${separator}body=${encodeURIComponent(body)}`);
}

/**
 * Sends an SMS straight off the device's own SIM on Android — no
 * composer, no other app opening, ever — via VoxoSmsAutoReplyModule's
 * own sendSms (native, subscription-aware; see its own doc for why
 * react-native-get-sms-android's autoSend was dropped: it always called
 * the bare SmsManager.getDefault(), which fails outright on a dual-SIM
 * phone with no default SIM chosen for SMS and used to fall back to an
 * "Open with" app chooser nobody asked for). A failure now surfaces as
 * an alert with the real reason instead — nothing opens, so the agent
 * is never left wondering why Messages or WhatsApp suddenly appeared.
 *
 * iOS is the one genuine exception: Apple gives no app a way to send
 * SMS on the user's behalf at all, so the native compose sheet opening
 * there is the only path that exists, not a fallback VOXO is choosing.
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
    // On Android 13+, a sideloaded APK's permission request can be
    // silently blocked by "Restricted settings" until the agent allows
    // it from the app's own Info page — see Settings > Permissions.
    Alert.alert(
      'Could not send',
      'VOXO doesn\'t have permission to send SMS, so nothing was sent. Check Settings > Permissions — if "Send SMS" is blocked, open this app\'s own Info page (long-press the VOXO icon > App info > ⋮) and allow restricted settings first, then grant it and try again.',
    );
    return;
  }

  try {
    await sendSmsNative(phone, body);
    recordSmsSent();
  } catch (err) {
    // The native reason (see VoxoSmsAutoReplyModule.sendSms) — a dual-SIM
    // phone with no default SIM chosen for SMS was the common cause
    // getSmsManager now resolves around; a genuine radio/signal failure
    // can still surface here, which is why this stays an alert rather
    // than a silent retry.
    const reason = err instanceof Error ? err.message : 'Could not send';
    Alert.alert(
      'Could not send',
      `${reason}. Nothing opened — try sending again in a moment. If this keeps happening on a dual-SIM phone, check Settings > Apps > Messages (or SIM cards) for a default SIM chosen for SMS.`,
    );
  }
}
