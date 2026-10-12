import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, PermissionsAndroid, Platform, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeProvider';
import { formatChatListTime } from '../../utils/formatTime';
import { isIndianMobileSender } from '../../utils/smsLeadMatch';
import { listInboxSms } from '../../utils/localSmsInbox';

interface MatchedSms {
  id: number;
  address: string;
  body: string;
  date: number;
}

type PermissionState = 'unknown' | 'granted' | 'denied';

/**
 * Messages from the phone's own SMS inbox that look like they came from a
 * real person's number — filtered locally on-device by sender shape (see
 * isIndianMobileSender), never by what a message says, and never the
 * agent's whole personal inbox: an OTP, bank alert or promotional blast
 * comes from an alphanumeric or short-code sender id and is excluded by
 * that filter regardless of its text. Android only: there is no
 * equivalent API on iOS to read another app's SMS at all.
 */
export function SmsInboxScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [messages, setMessages] = useState<MatchedSms[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const raw = await listInboxSms();
      const matched = raw
        .filter((sms) => isIndianMobileSender(sms.address))
        .map((sms) => ({ id: sms._id, address: sms.address, body: sms.body, date: sms.date }))
        .sort((a, b) => b.date - a.date);
      setMessages(matched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the SMS inbox.');
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  const requestAccess = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
      title: 'SMS access',
      message: 'VOXO reads your SMS inbox on this screen only, to find messages mentioning your leads.',
      buttonPositive: 'Allow',
    });
    const isGranted = granted === PermissionsAndroid.RESULTS.GRANTED;
    setPermission(isGranted ? 'granted' : 'denied');
    if (isGranted) void load(false);
  }, [load]);

  // Re-checks and reloads every time this screen comes back into focus —
  // not just on first mount — so a text that arrived while the agent was
  // elsewhere in the app, or a permission granted from outside VOXO
  // entirely (phone Settings, after an "Allow restricted settings" step),
  // shows up here without the screen needing to be freshly opened.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS).then((already) => {
        if (already) {
          setPermission('granted');
          void load(false);
        } else {
          setPermission('denied');
        }
      });
    }, [load]),
  );

  const emptyState = useMemo(() => {
    if (loading) return null;
    if (!messages.length) {
      return (
        <View style={styles.centered}>
          <Ionicons name="chatbox-outline" size={28} color={colors.textTertiary} />
          <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' }]}>
            No SMS from a real mobile number yet.
          </Text>
        </View>
      );
    }
    return null;
  }, [loading, messages.length, colors, typography, spacing]);

  if (Platform.OS !== 'android') {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            SMS access is only available on Android.
          </Text>
        </View>
      </Screen>
    );
  }

  if (permission !== 'granted') {
    return (
      <Screen>
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={28} color={colors.textTertiary} />
          <Text style={[typography.body, { color: colors.textPrimary, marginTop: spacing.sm, textAlign: 'center' }]}>
            VOXO needs permission to read your SMS inbox to show messages matching your leads here.
          </Text>
          <View style={{ marginTop: spacing.md }}>
            <Button label="Grant access" onPress={() => void requestAccess()} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={messages}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: spacing.md, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
        ListEmptyComponent={error ? (
          <View style={styles.centered}>
            <Text style={[typography.body, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
          </View>
        ) : (
          emptyState
        )}
        renderItem={({ item }) => (
          <View
            style={[
              styles.row,
              { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
            ]}
          >
            <View style={styles.rowHeader}>
              <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{item.address}</Text>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>
                {formatChatListTime(new Date(item.date).toISOString())}
              </Text>
            </View>
            <Text style={[typography.body, { color: colors.textSecondary, marginTop: 4 }]}>{item.body}</Text>
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  row: {},
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
