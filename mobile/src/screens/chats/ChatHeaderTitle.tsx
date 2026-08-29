import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatWindowRemaining } from '../../utils/formatTime';

interface ChatHeaderTitleProps {
  name: string;
  /** Meta's 24-hour customer-service window expiry, from the conversation. */
  windowExpiresAt?: string;
  withinWindow: boolean;
  /** Sample data — the window is not a real constraint there, so none of
   *  it is shown. See the Conversation type's isDemo. */
  isDemo?: boolean;
}

/** Re-checked once a minute — enough to keep an hours/minutes label honest
 *  without re-rendering the header on a per-second tick nobody reads. */
const TICK_MS = 60_000;

/**
 * Contact name plus how long is left to send a free-form reply.
 *
 * The 24-hour window was previously invisible until it had already closed
 * and a send was refused. Showing the remaining time turns that into
 * something the user can act on — the whole point is to notice it at "45m
 * left", not after the fact.
 *
 * Only warns near the end. A full green "23h left" badge on every chat is
 * noise; what matters is the last stretch.
 */
export function ChatHeaderTitle({ name, windowExpiresAt, withinWindow, isDemo = false }: ChatHeaderTitleProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!withinWindow || isDemo) return;
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, [withinWindow, isDemo]);

  const remaining = withinWindow && !isDemo ? formatWindowRemaining(windowExpiresAt) : null;
  // "Urgent" is under two hours: still comfortably actionable, but close
  // enough that the reply should not wait for tomorrow.
  const urgent = remaining !== null && remaining.endsWith('m left');

  return (
    <View style={styles.wrap}>
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      {isDemo ? (
        <Text style={[styles.subtitle, styles.normal]} numberOfLines={1}>
          Sample chat
        </Text>
      ) : !withinWindow ? (
        <Text style={[styles.subtitle, styles.closed]} numberOfLines={1}>
          Reply window closed · template only
        </Text>
      ) : remaining ? (
        <Text style={[styles.subtitle, urgent ? styles.urgent : styles.normal]} numberOfLines={1}>
          {remaining} to reply freely
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  // The header is a fixed navy in both schemes (see chatHeaderBackground),
  // so these colors are fixed against it rather than theme tokens.
  name: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  subtitle: { fontSize: 11, marginTop: 1 },
  normal: { color: 'rgba(255,255,255,0.65)' },
  urgent: { color: '#F0B84B' },
  closed: { color: '#F0B84B' },
});
