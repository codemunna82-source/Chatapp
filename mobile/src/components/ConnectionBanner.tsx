import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { onlineManager } from '@tanstack/react-query';
import { useTheme } from '../theme/ThemeProvider';
import { useSocketConnection } from '../sockets/useSocketConnected';
import { useOutboxStore } from '../store/outboxStore';

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
 * Two states, one strip. When the device itself has no connection the
 * cause is known and worth naming — along with how many messages are
 * waiting in the outbox, which is the difference between "my message
 * vanished" and "my message is queued". When the device is online but the
 * socket is not, all that can honestly be said is that it is reconnecting.
 *
 * Deliberately one component rather than two banners: they would otherwise
 * stack, and an offline phone always fails both checks at once.
 *
 * Rendered by the chat screens rather than globally: those are the only
 * places where being disconnected changes what the user should believe
 * about what they are looking at.
 */
export function ConnectionBanner() {
  const { colors, spacing, typography } = useTheme();
  const { connected } = useSocketConnection();
  const [online, setOnline] = useState(onlineManager.isOnline());
  const queued = useOutboxStore((s) => s.items.length);
  // Only whether the grace period has elapsed is stored; whether to show
  // the banner is derived from that plus the live connection state, so a
  // reconnect hides it without an effect having to write state back.
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => onlineManager.subscribe(setOnline), []);

  useEffect(() => {
    if (connected) return;
    const timer = setTimeout(() => setGraceElapsed(true), SHOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setGraceElapsed(false);
    };
  }, [connected]);

  // No grace period when the device is knowingly offline: there is nothing
  // transient to wait out, and the queued count is information the user
  // wants immediately.
  const visible = !online || (!connected && graceElapsed);

  if (!visible) return null;

  const message = !online
    ? queued > 0
      ? `No connection — ${queued} message${queued === 1 ? '' : 's'} will send when you're back online`
      : 'No connection — messages you send will be queued'
    : 'Reconnecting — new messages may be delayed';

  return (
    <View
      style={[styles.banner, { backgroundColor: colors.warningMuted, paddingHorizontal: spacing.md }]}
      accessibilityLiveRegion="polite"
    >
      {online ? (
        <ActivityIndicator size="small" color={colors.warning} />
      ) : (
        <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
      )}
      <Text style={[typography.caption, { color: colors.warning, marginLeft: spacing.sm, flexShrink: 1 }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
});
