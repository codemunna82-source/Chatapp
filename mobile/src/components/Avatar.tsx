import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useAuthStore } from '../store/authStore';
import { userAvatarUrl } from '../api/endpoints/users';

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
function AvatarPhoto({ userId, version, label, size }: { userId: string; version?: string; label: string; size: number }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [failed, setFailed] = useState(false);

  // A fresh {uri, headers} object each render makes RN's Image see a new
  // source and re-fetch through the authenticated media proxy. Memoize so
  // the request happens once per avatar.
  const source = useMemo(
    () => ({
      uri: userAvatarUrl(userId, version),
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    }),
    [userId, version, accessToken],
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
  /** Cache-busting token (e.g. the user's avatarUpdatedAt) — bump it after a re-upload so a stale cached image isn't shown at the same URL. */
  version?: string;
}

/** Initials-based placeholder, or a real uploaded photo when `userId` is given. */
export function Avatar({ label, size = 48, userId, version }: AvatarProps) {
  if (userId) {
    return <AvatarPhoto key={`${userId}:${version ?? ''}`} userId={userId} version={version} label={label} size={size} />;
  }
  return <InitialsCircle label={label} size={size} />;
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '600' },
});
