import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
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
  /**
   * WhatsApp replies left before the private link is the only way
   * through — see the backend's whatsappQuota.ts.
   *
   * Null or absent means the question does not apply here (a demo chat,
   * or a customer already reading in their private window).
   */
  whatsappRepliesLeft?: number | null;
  /** Whose photo to show. Absent on a conversation with no contact yet. */
  contactId?: string;
  /** The contact's avatarUpdatedAt — busts the image cache after an upload. */
  avatarUpdatedAt?: string;
  /** Tapping the photo sets a new one. Omitted makes it a plain image. */
  onPressAvatar?: () => void;
  /** The header's text colour for the current scheme — see chatTheme. */
  foreground?: string;
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
  whatsappRepliesLeft,
  contactId,
  avatarUpdatedAt,
  onPressAvatar,
  foreground,
}: ChatHeaderTitleProps) {
  // The header follows the scheme, so the name and the line under it are
  // drawn against whatever it currently is rather than assumed white.
  const fg = foreground ?? '#111B21';
  const sub = `${fg}A6`;
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
    <View style={styles.row}>
      {/* The customer's photo, and the place to set one.
          The chat header had no picture at all, so a DP uploaded from
          Manage contacts never appeared anywhere anyone looked — and the
          only way to set one was a screen most people never open. Putting
          it here makes both true at once: you see whose chat this is, and
          tapping it is how the photo gets there.
          Falls back to initials, which is what Avatar already does when
          there is no photo or it cannot be fetched. */}
      {contactId ? (
        <Pressable
          onPress={onPressAvatar}
          disabled={!onPressAvatar}
          hitSlop={8}
          accessibilityRole={onPressAvatar ? 'button' : 'image'}
          accessibilityLabel={onPressAvatar ? `Change ${name}'s photo` : `${name}'s photo`}
          style={styles.avatar}
        >
          <Avatar label={name} contactId={contactId} version={avatarUpdatedAt} size={36} />
        </Pressable>
      ) : null}

      <View style={styles.wrap}>
      <Text style={[styles.name, { color: fg }]} numberOfLines={1}>
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
        <Text style={[styles.subtitle, { color: sub }]} numberOfLines={1}>
          Sample chat
        </Text>
      ) : !withinWindow ? (
        <Text style={[styles.subtitle, styles.closed]} numberOfLines={1}>
          Reply window closed · template only
        </Text>
      ) : typeof whatsappRepliesLeft === 'number' ? (
        /**
         * How many WhatsApp replies are left before the private link is
         * the only way through.
         *
         * Above `guestActive`, and that ordering is the point. A LIVE
         * link is not an OPENED one, and the line below used to say
         * "Private chat open · reply anytime" the moment one was issued —
         * which was already a stretch and is now simply untrue: until the
         * customer actually opens it, replies go out over WhatsApp and
         * there are three of them. The server only sends a number in
         * exactly that case (it sends null once they have moved), so a
         * number here IS "they have not arrived yet".
         *
         * Above the 24-hour countdown too, for the same reason it is
         * worth showing at all: three replies run out long before a day
         * does, so it is the limit that actually bites. Said BEFORE it
         * happens, because the alternative is discovering it by hitting
         * it — with a message typed and a customer waiting.
         */
        <Text
          style={[styles.subtitle, whatsappRepliesLeft === 0 ? styles.closed : { color: sub }]}
          numberOfLines={1}
        >
          {whatsappRepliesLeft === 0
            ? 'No WhatsApp replies left · send the private link'
            : `${whatsappRepliesLeft} WhatsApp ${whatsappRepliesLeft === 1 ? 'reply' : 'replies'} left · then the private link`}
        </Text>
      ) : guestActive ? (
        // No clock and no warning: the customer is in the private chat, so
        // they can be replied to at any hour and as often as needed. Meta's
        // window still governs WhatsApp, but it stops being the user's
        // problem the moment the conversation has moved — and showing it
        // anyway taught people to worry about a deadline that no longer
        // applies to them.
        <Text style={[styles.subtitle, { color: sub }]} numberOfLines={1}>
          Private chat open · reply anytime
        </Text>
      ) : remaining ? (
        <Text style={[styles.subtitle, urgent ? styles.urgent : { color: sub }]} numberOfLines={1}>
          {remaining} to reply freely
        </Text>
      ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  avatar: { marginRight: 10 },
  // Shrinks rather than pushing the avatar off: a long name should
  // ellipsize, not shove the photo out of the header.
  wrap: { justifyContent: 'center', flexShrink: 1 },
  // The header follows the scheme now (see chatTheme's
  // chatHeaderBackground / chatHeaderForeground), so the name and subtitle
  // take their colour from the caller rather than assuming white on navy.
  name: { fontSize: 17, fontWeight: '600' },
  subtitle: { fontSize: 11, marginTop: 1 },
  urgentColor: { color: '#F0B84B' },
  urgent: { color: '#E8A33D' },
  closed: { color: '#E8A33D' },
  presenceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#00A884' },
  present: { color: '#00A884', marginTop: 0 },
});
