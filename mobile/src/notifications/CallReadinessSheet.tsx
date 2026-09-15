import React, { useEffect } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { touchTarget } from '../theme/spacing';
import { useCallReadinessStore, type ReadinessIssue } from './callReadiness';

/**
 * What is stopping calls from arriving, and the button that fixes it.
 *
 * Every setting a call notification depends on belongs to the user and
 * fails silently when it is wrong — a blocked channel, a battery
 * optimisation, an OEM autostart switch. None of them report anything.
 * This is the only place the app can say so.
 *
 * Each row opens the EXACT screen rather than describing where to find
 * it. "Settings → Apps → VOXO → Notifications → Full screen" is a path
 * people give up halfway through.
 */
export function CallReadinessSheet() {
  const { colors, spacing, radius, typography } = useTheme();
  const open = useCallReadinessStore((s) => s.open);
  const issues = useCallReadinessStore((s) => s.issues);
  const dismiss = useCallReadinessStore((s) => s.dismiss);

  const blocking = issues.filter((i) => i.severity === 'blocking');
  const advisory = issues.filter((i) => i.severity === 'advisory');

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={dismiss}>
      <Pressable style={[styles.scrim, { backgroundColor: colors.overlay }]} onPress={dismiss} />

      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surfaceElevated,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            paddingBottom: spacing.lg,
          },
        ]}
      >
        <View style={[styles.header, { paddingHorizontal: spacing.md, paddingVertical: spacing.sm }]}>
          <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>
            {blocking.length > 0 ? 'Calls may not reach you' : 'Call alerts'}
          </Text>
          <Pressable onPress={dismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            {({ pressed }) => (
              <Ionicons name="close" size={22} color={colors.textSecondary} style={{ opacity: pressed ? 0.5 : 1 }} />
            )}
          </Pressable>
        </View>

        <ScrollView style={styles.listScroll} showsVerticalScrollIndicator={false}>
          {blocking.length === 0 ? (
            <View style={[styles.okRow, { paddingHorizontal: spacing.md, paddingBottom: spacing.sm }]}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <Text style={[typography.body, { color: colors.textSecondary, marginLeft: spacing.xs, flex: 1 }]}>
                Everything this app can check is set correctly.
              </Text>
            </View>
          ) : (
            blocking.map((issue) => (
              <IssueRow key={issue.id} issue={issue} tone="blocking" />
            ))
          )}

          {advisory.length > 0 ? (
            <>
              <Text
                style={[
                  typography.caption,
                  { color: colors.textTertiary, paddingHorizontal: spacing.md, marginTop: spacing.md },
                ]}
              >
                {/* Said plainly: these cannot be read back, so the honest
                    thing is to say so rather than show a tick nobody
                    earned. */}
                Android does not let VOXO read these — worth checking once.
              </Text>
              {advisory.map((issue) => (
                <IssueRow key={issue.id} issue={issue} tone="advisory" />
              ))}
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function IssueRow({ issue, tone }: { issue: ReadinessIssue; tone: 'blocking' | 'advisory' }) {
  const { colors, spacing, radius, typography } = useTheme();
  return (
    <Pressable
      onPress={() => {
        void issue.open();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${issue.title}. Open settings.`}
      style={({ pressed }) => [
        styles.issue,
        {
          marginHorizontal: spacing.md,
          marginTop: spacing.sm,
          padding: spacing.md,
          borderRadius: radius.md,
          backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
        },
      ]}
    >
      <Ionicons
        name={tone === 'blocking' ? 'alert-circle' : 'information-circle-outline'}
        size={20}
        color={tone === 'blocking' ? colors.warning : colors.textTertiary}
      />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{issue.title}</Text>
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>{issue.detail}</Text>
        <Text style={[typography.caption, { color: colors.success, marginTop: spacing.xs }]}>Open settings ›</Text>
      </View>
    </Pressable>
  );
}

/**
 * Re-checks whenever the app comes back to the front, which is exactly
 * when a setting may just have been changed — the buttons above send
 * people out to system screens and Android gives no callback when they
 * return.
 *
 * Only a DETECTED problem raises the sheet, and only once a day after it
 * is dismissed. A prompt about something that might already be fine is
 * one people learn to swipe away without reading.
 */
export function CallReadinessWatcher(): null {
  const refresh = useCallReadinessStore((s) => s.refresh);

  useEffect(() => {
    void refresh({ prompt: true });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh({ prompt: true });
    });
    return () => sub.remove();
  }, [refresh]);

  return null;
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  sheet: { maxHeight: '72%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listScroll: { flexGrow: 0 },
  okRow: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget.compact },
  issue: { flexDirection: 'row', alignItems: 'flex-start' },
});
