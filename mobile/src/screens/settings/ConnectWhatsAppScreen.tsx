import React, { useCallback, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/Button';
import { InlineBanner } from '../../components/InlineBanner';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { useTheme } from '../../theme/ThemeProvider';
import { env } from '../../utils/env';
import { getApiErrorMessage } from '../../api/client';
import { captureHandledError } from '../../lib/sentry';
import {
  useWhatsAppConnection,
  useConnectWhatsApp,
  useDisconnectWhatsApp,
} from '../../queries/useWhatsAppConnection';

/**
 * The states this screen can be in. Named rather than derived from a
 * tangle of booleans, because "connecting" and "failed" both have to
 * survive the WebView closing, and a boolean pair gets those wrong.
 */
type Phase = 'idle' | 'signing-in' | 'exchanging' | 'failed';

/** The messages the hosted signup page sends back. */
type SignupMessage =
  | { type: 'code'; code: string }
  | { type: 'cancelled' }
  | { type: 'error'; message?: string }
  | { type: 'signup_event'; event?: string };

const SIGNUP_URL = `${env.EXPO_PUBLIC_API_URL.replace(/\/$/, '')}/api/whatsapp/signup`;

export function ConnectWhatsAppScreen() {
  const { colors, spacing, typography, radius } = useTheme();
  const connection = useWhatsAppConnection();
  const connect = useConnectWhatsApp();
  const disconnect = useDisconnectWhatsApp();

  const [phase, setPhase] = useState<Phase>('idle');
  const [webViewOpen, setWebViewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: SignupMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data) as SignupMessage;
      } catch {
        // The page only ever posts JSON; anything else is not ours.
        return;
      }

      if (msg.type === 'signup_event') return; // progress only

      // Closed before the exchange, so the user is not left staring at a
      // Facebook page while a request runs behind it.
      setWebViewOpen(false);

      if (msg.type === 'cancelled') {
        setPhase('idle');
        return;
      }
      if (msg.type === 'error') {
        setError(msg.message ?? 'Facebook could not start the connection.');
        setPhase('failed');
        return;
      }

      setPhase('exchanging');
      connect.mutate(msg.code, {
        onSuccess: () => {
          setPhase('idle');
          setError(null);
        },
        onError: (err) => {
          const message = getApiErrorMessage(err, 'Could not complete the connection.');
          setError(message);
          setPhase('failed');
          // A failure here is server-side — a rejected code, a missing
          // subscription — and is invisible in the app's own logs.
          captureHandledError(err, { stage: 'whatsapp-connect' });
        },
      });
    },
    [connect],
  );

  const startSignup = () => {
    setError(null);
    setPhase('signing-in');
    setWebViewOpen(true);
  };

  const data = connection.data;

  if (connection.isLoading) {
    return (
      <View style={styles.center}>
        <LoadingIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md }}>
      {/* Shown above everything: an expiring or rejected token is the
          reason sends are about to stop, or already have, and it is the
          one thing on this screen the user must act on. */}
      {data?.needsReconnect ? (
        <InlineBanner
          tone={data.connected ? 'warning' : 'danger'}
          message={
            !data.connected
              ? 'Your WhatsApp connection has expired. Messages will not send until you reconnect.'
              : typeof data.daysUntilExpiry === 'number' && data.daysUntilExpiry >= 0
                ? `This connection expires in ${data.daysUntilExpiry} day${data.daysUntilExpiry === 1 ? '' : 's'}. Reconnect to keep sending.`
                : 'This connection has expired. Reconnect to keep sending.'
          }
        />
      ) : null}

      {data?.connected || data?.needsReconnect ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
          ]}
        >
          <View style={styles.rowCenter}>
            <Ionicons
              name={data.connected ? 'checkmark-circle' : 'alert-circle'}
              size={26}
              color={data.connected ? colors.success : colors.danger}
            />
            <Text
              style={[
                typography.bodyMedium,
                { color: data.connected ? colors.success : colors.danger, marginLeft: spacing.sm },
              ]}
            >
              {data.connected ? 'WhatsApp Connected' : 'Reconnection needed'}
            </Text>
          </View>
          <Text style={[typography.heading, { color: colors.textPrimary, marginTop: spacing.sm }]}>
            {data.displayPhoneNumber}
          </Text>
          {data.verifiedName ? (
            <Text style={[typography.body, { color: colors.textSecondary }]}>{data.verifiedName}</Text>
          ) : null}
          {data.connectedAt ? (
            <Text style={[typography.caption, { color: colors.textTertiary, marginTop: spacing.xs }]}>
              Connected {new Date(data.connectedAt).toLocaleDateString()}
            </Text>
          ) : null}
          {data.tokenExpiresAt ? (
            <Text style={[typography.caption, { color: colors.textTertiary }]}>
              Access expires {new Date(data.tokenExpiresAt).toLocaleDateString()}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={{ marginBottom: spacing.md }}>
          <Text style={[typography.body, { color: colors.textPrimary, marginBottom: spacing.xs }]}>
            Not connected
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            Connect your own WhatsApp Business number to send and receive messages here. Facebook handles the
            login and number verification — this app never sees your WhatsApp password or access token.
          </Text>
        </View>
      )}

      {error ? <InlineBanner message={error} /> : null}

      {phase === 'exchanging' ? (
        <View style={[styles.rowCenter, { marginBottom: spacing.md }]}>
          <LoadingIndicator />
          <Text style={[typography.body, { color: colors.textSecondary, marginLeft: spacing.sm }]}>
            Finishing the connection…
          </Text>
        </View>
      ) : null}

      {data?.connected || data?.needsReconnect ? (
        <>
          <Button
            label="Reconnect"
            // Primary when it is the action the screen is asking for.
            variant={data?.needsReconnect ? 'primary' : 'secondary'}
            onPress={startSignup}
            disabled={phase === 'exchanging'}
          />
          <View style={{ height: spacing.sm }} />
          <Button
            label="Disconnect"
            variant="danger"
            loading={disconnect.isPending}
            onPress={() =>
              disconnect.mutate(undefined, {
                onError: (err) => setError(getApiErrorMessage(err, 'Could not disconnect.')),
              })
            }
          />
        </>
      ) : (
        <Button
          label={phase === 'failed' ? 'Try again' : 'Connect WhatsApp'}
          onPress={startSignup}
          loading={phase === 'exchanging'}
          disabled={phase === 'exchanging'}
        />
      )}

      <Modal visible={webViewOpen} animationType="slide" onRequestClose={() => setWebViewOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[styles.modalBar, { padding: spacing.sm, borderBottomColor: colors.border }]}>
            <Text style={[typography.bodyMedium, { color: colors.textPrimary, flex: 1 }]}>Connect WhatsApp</Text>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => {
                setWebViewOpen(false);
                setPhase('idle');
              }}
            />
          </View>
          <WebView
            source={{ uri: SIGNUP_URL }}
            onMessage={handleMessage}
            javaScriptEnabled
            domStorageEnabled
            // Kept false deliberately, and the server side is built around
            // it: the signup flow navigates this same view to Facebook and
            // back rather than opening a popup, because a WebView has no
            // popups — `window.open` returns null and anything waiting on
            // its handle stalls silently, which is exactly how the first
            // version of this failed.
            setSupportMultipleWindows={false}
            onError={() => {
              setWebViewOpen(false);
              setError('Could not load the connection page. Check your internet and try again.');
              setPhase('failed');
            }}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.center}>
                <LoadingIndicator />
              </View>
            )}
          />
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {},
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  modalBar: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
});
