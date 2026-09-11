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
  /** The customer has their web chat window open right now. */
  guestOnline?: boolean;
  /**
   * A private chat link is live for this conversation.
   *
   * Distinct from guestOnline, which is "they are looking at it this
   * second". This is the one that decides whether the 24-hour countdown
   * means anything: with a live link there is always a way to reach the
   * customer, so a clock counting down to a restriction that will not
   * apply is just anxiety on the header of every chat.
   */
  guestActive?: boolean;
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
export function ChatHeaderTitle({
  name,
  windowExpiresAt,
  withinWindow,
  isDemo = false,
  guestOnline = false,
  guestActive = false,
}: ChatHeaderTitleProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!withinWindow || isDemo || guestActive) return;
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, [withinWindow, isDemo, guestActive]);

  const remaining =
    withinWindow && !isDemo && !guestActive ? formatWindowRemaining(windowExpiresAt) : null;
  // "Urgent" is under two hours: still comfortably actionable, but close
  // enough that the reply should not wait for tomorrow.
  const urgent = remaining !== null && remaining.endsWith('m left');

  return (
    <View style={styles.wrap}>
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      {/* Ahead of the window countdown, because it outranks it: a customer
          sitting in the web window can be replied to whatever Meta's
          24-hour clock says. */}
      {guestOnline ? (
        <View style={styles.presenceRow}>
          <View style={styles.dot} />
          <Text style={[styles.subtitle, styles.present]} numberOfLines={1}>
            In the private chat now
          </Text>
        </View>
      ) : isDemo ? (
        <Text style={[styles.subtitle, styles.normal]} numberOfLines={1}>
          Sample chat
        </Text>
      ) : guestActive ? (
        // No clock and no warning: the link is live, so this customer can be
        // replied to at any hour. Meta's window still governs WhatsApp, but
        // it stops being the user's problem the moment there is another way
        // through — and showing it anyway taught people to worry about a
        // deadline that no longer applies to them.
        <Text style={[styles.subtitle, styles.normal]} numberOfLines={1}>
          Private chat open · reply anytime
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
  presenceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#4ADE80' },
  present: { color: '#4ADE80', marginTop: 0 },
});
