import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useSocketConnection } from '../sockets/useSocketConnected';

/** Brief drops are invisible to the user and recover on their own; showing a
 *  banner for each one is worse than showing nothing. Only a drop that
 *  outlasts this is worth interrupting the UI for. */
const SHOW_AFTER_MS = 2500;

/**
 * Tells the user when the realtime link is down, because nothing else does.
 * Without it a disconnected app looks identical to a quiet one — no new
 * messages arrive, sends fail one by one with no explanation, and the only
 * clue is that the chat has gone still.
 *
 * Rendered by the chat screens rather than globally: those are the only
 * places where being disconnected changes what the user should believe
 * about what they are looking at.
 */
export function ConnectionBanner() {
  const { colors, spacing, typography } = useTheme();
  const { connected } = useSocketConnection();
  // Only whether the grace period has elapsed is stored; whether to show
  // the banner is derived from that plus the live connection state, so a
  // reconnect hides it without an effect having to write state back.
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    if (connected) return;
    const timer = setTimeout(() => setGraceElapsed(true), SHOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setGraceElapsed(false);
    };
  }, [connected]);

  const visible = !connected && graceElapsed;

  if (!visible) return null;

  return (
    <View
      style={[styles.banner, { backgroundColor: colors.warningMuted, paddingHorizontal: spacing.md }]}
      accessibilityLiveRegion="polite"
    >
      <ActivityIndicator size="small" color={colors.warning} />
      <Text style={[typography.caption, { color: colors.warning, marginLeft: spacing.sm }]}>
        Reconnecting — new messages may be delayed
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
});
