import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  PermissionsAndroid,
  Platform,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import { usePersonalLink, useUpdatePersonalLinkTemplate } from '../../queries/useAuthMutations';
import { getApiErrorMessage } from '../../api/client';
import { getSmsSentToday } from '../../storage/smsSendTracker';
import { getSmsAutoReplyStatus, setSmsAutoReplyConfig, setSmsAutoReplyDailyLimit } from '../../native/smsAutoReply';

const DEFAULT_TEMPLATE_PLACEHOLDER = 'Hi 👋, you can reach me directly here 🔗';
/** 0 is VoxoSmsAutoReplyModule.UNLIMITED_DAILY_LIMIT — no cap at all, not "zero allowed". */
const DAILY_LIMIT_PRESETS: { label: string; value: number }[] = [
  { label: '20', value: 20 },
  { label: '50', value: 50 },
  { label: '100', value: 100 },
  { label: '200', value: 200 },
  { label: 'Unlimited', value: 0 },
];

/** What SmsAutoReplyReceiver actually sends — the template (or the same default shown as a placeholder) plus the link, each on its own line. */
function buildAutoReplyText(messageTemplate: string | null | undefined, url: string): string {
  return `${messageTemplate?.trim() || DEFAULT_TEMPLATE_PLACEHOLDER}\n${url}`;
}

/**
 * This user's own permanent "chat with me" link — the same URL every
 * time, unlike a per-conversation guest link (Contact info's own
 * "Private chat link" row). Whoever opens it ends up talking with THIS
 * person specifically, even a stranger who has never messaged before:
 * the backend mints them a brand-new, isolated contact and conversation
 * on the spot (see personalGuestLink.routes.ts) rather than granting
 * access to anyone else's.
 */
export function PrivateChatLinkSection() {
  const { colors, spacing, radius, typography } = useTheme();
  const linkQuery = usePersonalLink();
  const updateTemplate = useUpdatePersonalLinkTemplate();
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [draftTemplate, setDraftTemplate] = useState('');
  const isFocused = useIsFocused();
  // Re-reads the MMKV counter each time this screen comes back into focus,
  // so a send made elsewhere (the conversation screen) shows up here
  // without this screen needing its own subscription to that store.
  const smsSentToday = useMemo(() => (isFocused ? getSmsSentToday() : 0), [isFocused]);

  // The switch's real state lives in SmsAutoReplyReceiver's own
  // SharedPreferences, not here — this is just this screen's last read
  // of it, refreshed on focus the same way smsSentToday is.
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [autoRepliedCount, setAutoRepliedCount] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(100);
  const [sentToday, setSentToday] = useState(0);
  useEffect(() => {
    if (!isFocused || Platform.OS !== 'android') return;
    void getSmsAutoReplyStatus().then((status) => {
      setAutoReplyEnabled(status.enabled);
      setAutoRepliedCount(status.repliedCount);
      setDailyLimit(status.dailyLimit);
      setSentToday(status.sentToday);
    });
  }, [isFocused]);

  const changeDailyLimit = useCallback((limit: number) => {
    setDailyLimit(limit);
    setSmsAutoReplyDailyLimit(limit);
  }, []);

  const linkUrl = linkQuery.data?.url;

  // Keeps the receiver's own copy of the reply text current whenever the
  // link, the template, or the switch itself changes — it has no other
  // way to find out, since it is woken by the OS, not by this screen.
  useEffect(() => {
    if (!linkUrl) return;
    setSmsAutoReplyConfig(autoReplyEnabled, buildAutoReplyText(linkQuery.data?.messageTemplate, linkUrl));
  }, [autoReplyEnabled, linkQuery.data?.messageTemplate, linkUrl]);

  const toggleAutoReply = useCallback(async (next: boolean) => {
    if (!next) {
      setAutoReplyEnabled(false);
      return;
    }
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS, {
      title: 'Receive SMS',
      message: 'VOXO needs this to notice an incoming SMS and reply to it automatically.',
      buttonPositive: 'Allow',
    });
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      Alert.alert('Permission needed', 'Auto-reply needs permission to receive SMS.');
      return;
    }
    setAutoReplyEnabled(true);
  }, []);
  const copyLink = useCallback(() => {
    if (!linkUrl) return;
    void Clipboard.setStringAsync(linkUrl);
    Alert.alert('Link copied', 'Your personal chat link has been copied to your clipboard.');
  }, [linkUrl]);

  const openTemplateEditor = useCallback(() => {
    setDraftTemplate(linkQuery.data?.messageTemplate ?? '');
    setEditingTemplate(true);
  }, [linkQuery.data?.messageTemplate]);

  const saveTemplate = useCallback(() => {
    updateTemplate.mutate(draftTemplate.trim() || null, {
      onSuccess: () => setEditingTemplate(false),
      onError: (err) => Alert.alert('Could not save', getApiErrorMessage(err)),
    });
  }, [draftTemplate, updateTemplate]);

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
        Private chat
      </Text>

      <View
        style={{
          backgroundColor: colors.surfaceAlt,
          borderRadius: radius.md,
          padding: spacing.md,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="link-outline" size={20} color={colors.primary} />
          <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>My personal chat link</Text>
        </View>
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 6, lineHeight: 17 }]}>
          One link, always the same. Send it to anyone — whoever opens it ends up talking with you, even someone
          who has never messaged before.
        </Text>

        {linkQuery.isLoading ? (
          <ActivityIndicator style={{ marginTop: 12 }} color={colors.textSecondary} />
        ) : linkQuery.isError ? (
          <Text style={[typography.caption, { color: colors.danger, marginTop: 10 }]}>
            {getApiErrorMessage(linkQuery.error)}
          </Text>
        ) : (
          <Pressable
            onPress={copyLink}
            style={({ pressed }) => [
              {
                marginTop: 10,
                backgroundColor: colors.surfaceElevated,
                borderRadius: radius.sm,
                borderWidth: 1,
                borderColor: colors.border,
                paddingVertical: 10,
                paddingHorizontal: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Copy your personal chat link"
          >
            <Text style={[typography.body, { color: colors.textPrimary, flex: 1 }]} numberOfLines={1}>
              {linkQuery.data?.url}
            </Text>
            <Ionicons name="copy-outline" size={16} color={colors.primary} />
          </Pressable>
        )}
      </View>

      {editingTemplate ? (
        <View
          style={{
            marginTop: spacing.sm,
            backgroundColor: colors.surfaceAlt,
            borderRadius: radius.md,
            padding: spacing.md,
          }}
        >
          <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>Message template</Text>
          <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 4, lineHeight: 17 }]}>
            Used whenever you share your personal link. Leave it blank to use the default wording.
          </Text>
          <TextInput
            value={draftTemplate}
            onChangeText={setDraftTemplate}
            placeholder={DEFAULT_TEMPLATE_PLACEHOLDER}
            placeholderTextColor={colors.textTertiary}
            multiline
            style={[
              typography.body,
              {
                marginTop: 10,
                minHeight: 70,
                backgroundColor: colors.surfaceElevated,
                borderRadius: radius.sm,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 10,
                color: colors.textPrimary,
                textAlignVertical: 'top',
              },
            ]}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <Pressable
              onPress={() => setEditingTemplate(false)}
              disabled={updateTemplate.isPending}
              style={{ paddingVertical: 8, paddingHorizontal: 14 }}
              accessibilityRole="button"
              accessibilityLabel="Cancel editing the message template"
            >
              <Text style={[typography.bodyMedium, { color: colors.textSecondary }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={saveTemplate}
              disabled={updateTemplate.isPending}
              style={{
                backgroundColor: colors.primary,
                borderRadius: radius.full,
                paddingVertical: 8,
                paddingHorizontal: 18,
                opacity: updateTemplate.isPending ? 0.6 : 1,
              }}
              accessibilityRole="button"
              accessibilityLabel="Save the message template"
            >
              <Text style={[typography.bodyMedium, { color: colors.textOnPrimary }]}>
                {updateTemplate.isPending ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={openTemplateEditor}
          style={({ pressed }) => [
            {
              marginTop: spacing.sm,
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: spacing.sm + 4,
              minHeight: touchTarget.compact,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Edit your message template"
        >
          <Ionicons name="chatbox-ellipses-outline" size={20} color={colors.textSecondary} />
          <Text style={[typography.body, { color: colors.textPrimary, flex: 1, marginLeft: spacing.md }]}>
            Message template
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary, marginRight: spacing.sm }]}>
            {linkQuery.data?.messageTemplate ? 'Custom' : 'Default'}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>
      )}

      {Platform.OS === 'android' ? (
        <>
          <View
            style={{
              marginTop: spacing.sm,
              backgroundColor: colors.surfaceAlt,
              borderRadius: radius.md,
              padding: spacing.md,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>Auto-reply to lead SMS</Text>
              <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 4, lineHeight: 17 }]}>
                When an SMS arrives mentioning &ldquo;hii&rdquo;, &ldquo;saw&rdquo; or &ldquo;profile&rdquo;, VOXO
                texts back your personal chat link above — no need to open it and reply yourself. Those are common
                words, so this can occasionally reply to something unrelated; leave it off unless you want it.
                {autoRepliedCount > 0 ? ` Replied to ${autoRepliedCount} number${autoRepliedCount === 1 ? '' : 's'} so far.` : ''}
              </Text>
            </View>
            <Switch
              value={autoReplyEnabled}
              onValueChange={(next) => void toggleAutoReply(next)}
              trackColor={{ false: colors.border, true: colors.primary }}
              accessibilityRole="switch"
              accessibilityLabel="Auto-reply to lead SMS"
            />
          </View>

          <View
            style={{
              marginTop: spacing.sm,
              backgroundColor: colors.surfaceAlt,
              borderRadius: radius.md,
              padding: spacing.md,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>Daily limit</Text>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>
                {dailyLimit === 0 ? `${sentToday} sent today · unlimited` : `${sentToday} / ${dailyLimit} today`}
              </Text>
            </View>
            <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 4, lineHeight: 17 }]}>
              {dailyLimit === 0
                ? "No cap — every matching text gets a reply today, however many there are. Still spaced out (10-90s apart), just never stopped."
                : 'Stops scheduling new auto-replies once this many have gone out today — a safety net in case an unusually busy day would otherwise mean dozens of replies with nothing slowing it down.'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              {DAILY_LIMIT_PRESETS.map((preset) => {
                const active = dailyLimit === preset.value;
                return (
                  <Pressable
                    key={preset.value}
                    onPress={() => changeDailyLimit(preset.value)}
                    style={({ pressed }) => [
                      {
                        flex: 1,
                        alignItems: 'center',
                        paddingVertical: 8,
                        borderRadius: radius.full,
                        backgroundColor: active ? colors.primary : colors.surfaceElevated,
                        borderWidth: active ? 0 : 1,
                        borderColor: colors.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Daily limit ${preset.label}`}
                  >
                    <Text
                      style={[
                        typography.caption,
                        { color: active ? colors.textOnPrimary : colors.textPrimary, fontWeight: '600' },
                      ]}
                    >
                      {preset.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ marginTop: spacing.sm, paddingHorizontal: spacing.xs }}>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {smsSentToday} SMS sent via VOXO today
            </Text>
            <Text style={[typography.caption, { color: colors.textTertiary, marginTop: 2, lineHeight: 15 }]}>
              Android has no way for an app to read your SIM&apos;s own SMS-pack balance, so this is a count of what
              VOXO itself has sent — not what your carrier says is left.
            </Text>
          </View>
        </>
      ) : null}
    </View>
  );
}
