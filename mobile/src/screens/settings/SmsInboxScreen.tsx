import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, PermissionsAndroid, Platform, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SmsAndroid, { type RawSmsMessage } from 'react-native-get-sms-android';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeProvider';
import { formatChatListTime } from '../../utils/formatTime';

/**
 * The fixed list this screen filters for — never the whole SMS inbox. A
 * message has to contain at least one of these (case-insensitive) to show
 * up here at all; everything else a device's SMS app holds (OTPs, bank
 * alerts, personal messages) is read by the query below but never
 * rendered, stored, or sent anywhere off the device.
 */
const MATCH_KEYWORDS = ['hii', 'saw', 'profile'];
const MAX_SMS_SCANNED = 300;

interface MatchedSms {
  id: number;
  address: string;
  body: string;
  date: number;
}

function matchesKeywords(body: string): boolean {
  const lower = body.toLowerCase();
  return MATCH_KEYWORDS.some((kw) => lower.includes(kw));
}

function listInboxSms(): Promise<RawSmsMessage[]> {
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

type PermissionState = 'unknown' | 'granted' | 'denied';

/**
 * Messages from the phone's own SMS inbox that mention this workspace's
 * leads — matched locally on-device against a small fixed keyword list
 * (see MATCH_KEYWORDS), never the agent's whole personal inbox. Android
 * only: there is no equivalent API on iOS to read another app's SMS at
 * all, which is itself exactly the privacy boundary this screen respects
 * by filtering down to three words instead of mirroring everything.
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
        .filter((sms) => matchesKeywords(sms.body))
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

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS).then((already) => {
      if (already) {
        setPermission('granted');
        void load(false);
      } else {
        setPermission('denied');
      }
    });
  }, [load]);

  const emptyState = useMemo(() => {
    if (loading) return null;
    if (!messages.length) {
      return (
        <View style={styles.centered}>
          <Ionicons name="chatbox-outline" size={28} color={colors.textTertiary} />
          <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' }]}>
            No SMS matching &ldquo;{MATCH_KEYWORDS.join('", "')}&rdquo; yet.
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
