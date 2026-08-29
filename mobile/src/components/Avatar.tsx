import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useAuthStore } from '../store/authStore';
import { userAvatarUrl } from '../api/endpoints/users';
import { contactAvatarUrl } from '../api/endpoints/contacts';

const PALETTE = ['#4C3FE0', '#0E9384', '#C9861A', '#D64545', '#2463EB', '#9333EA'];

function colorForSeed(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

function InitialsCircle({ label, size }: { label: string; size: number }) {
  const { colors } = useTheme();
  const initial = (label.trim()[0] ?? '#').toUpperCase();
  const background = colorForSeed(label);
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: background }]}>
      <Text style={[styles.text, { fontSize: size * 0.42, color: colors.textOnPrimary }]}>{initial}</Text>
    </View>
  );
}

/**
 * Remounted (via the `key` the parent gives it) whenever userId/version
 * changes, so a new lookup always starts from `failed=false` — the React-
 * recommended way to reset state on a prop change without a setState-in-
 * effect (see react-hooks/set-state-in-effect).
 */
function AvatarPhoto({
  url,
  version,
  label,
  size,
}: {
  url: string;
  version?: string;
  label: string;
  size: number;
}) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [failed, setFailed] = useState(false);

  // A fresh {uri, headers} object each render makes RN's Image see a new
  // source and re-fetch through the authenticated media proxy. Memoize so
  // the request happens once per avatar.
  const source = useMemo(
    () => ({
      uri: url,
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    }),
    [url, accessToken],
  );

  if (failed) {
    return <InitialsCircle label={label} size={size} />;
  }

  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }]}>
      <Image source={source} style={{ width: size, height: size }} onError={() => setFailed(true)} />
    </View>
  );
}

interface AvatarProps {
  label: string; // name or phone — used both for the initial and the color seed
  size?: number;
  /**
   * App-user id (not a WhatsApp contact id) whose uploaded profile photo
   * should be rendered instead of the initials placeholder — see
   * user.routes.ts's GET /users/:id/avatar. Omit for contacts/anything
   * without a real photo upload path; falls back to initials on any
   * fetch error (no photo set, network error, etc.).
   */
  userId?: string;
  /**
   * WhatsApp contact id whose uploaded photo should be rendered — see
   * contact.routes.ts's GET /contacts/:id/avatar. Mutually exclusive with
   * userId in practice: one is a team member, the other a customer.
   *
   * The photo is one the WORKSPACE uploaded, not a sync: Meta's Cloud API
   * exposes no way to read a customer's WhatsApp profile picture.
   */
  contactId?: string;
  /** Cache-busting token (e.g. the user's or contact's avatarUpdatedAt) — bump it after a re-upload so a stale cached image isn't shown at the same URL. */
  version?: string;
}

/**
 * Initials placeholder, or a real uploaded photo when a userId or
 * contactId is given.
 *
 * Falls back to initials on ANY fetch failure — no photo set, offline, a
 * deleted image. That is the common case rather than an error worth
 * surfacing: most contacts will never have a photo.
 */
export function Avatar({ label, size = 48, userId, contactId, version }: AvatarProps) {
  if (userId) {
    return (
      <AvatarPhoto
        key={`u:${userId}:${version ?? ''}`}
        url={userAvatarUrl(userId, version)}
        version={version}
        label={label}
        size={size}
      />
    );
  }
  if (contactId) {
    return (
      <AvatarPhoto
        key={`c:${contactId}:${version ?? ''}`}
        url={contactAvatarUrl(contactId, version)}
        version={version}
        label={label}
        size={size}
      />
    );
  }
  return <InitialsCircle label={label} size={size} />;
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '600' },
});
