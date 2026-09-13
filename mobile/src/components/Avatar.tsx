import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
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
 *
 * Only ever mounted for someone who actually HAS a photo — see Avatar
 * below. Its `failed` fallback is for a photo that has since been deleted
 * or cannot be fetched right now, not for the ordinary no-photo case.
 */
function AvatarPhoto({
  url,
  cacheKey,
  label,
  size,
}: {
  url: string;
  /** Stable per photo VERSION, so a new upload is a new file. */
  cacheKey: string;
  label: string;
  size: number;
}) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  /**
   * Downloaded with the token, then rendered from disk.
   *
   * This used to hand RN's Image a `{uri, headers}` source and trust it to
   * send the Authorization header. On Android it does not: the server's
   * logs show the upload returning 200 and the very next GET for the same
   * photo arriving with no authorization header at all and coming back
   * 401 — so every avatar fell silently back to initials and a photo
   * someone had just cropped and uploaded looked like it had not saved.
   *
   * MediaImage already downloads its bytes this way for the same reason.
   * The cache is a bonus: the file is keyed by version, so it is fetched
   * once per photo rather than once per mount of every row that shows it.
   */
  useEffect(() => {
    let cancelled = false;
    const target = new File(Paths.cache, `voxo-avatar-${cacheKey}.img`);

    (async () => {
      try {
        if (target.exists) {
          if (!cancelled) setLocalUri(target.uri);
          return;
        }
        const result = await File.downloadFileAsync(url, target, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
          idempotent: true,
        });
        if (!cancelled) setLocalUri(result.uri);
      } catch {
        // No photo, offline, a deleted image — all the same answer here,
        // and initials are a perfectly good one.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      // A list row can scroll away mid-download; don't set state after.
      cancelled = true;
    };
  }, [url, cacheKey, accessToken]);

  if (failed) {
    return <InitialsCircle label={label} size={size} />;
  }

  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }]}>
      {localUri ? (
        <Image source={{ uri: localUri }} style={{ width: size, height: size }} onError={() => setFailed(true)} />
      ) : (
        // Initials while the bytes arrive, not a blank ring: on a list of
        // thirty rows a blank would read as thirty broken avatars.
        <InitialsCircle label={label} size={size} />
      )}
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
  /**
   * The subject's `avatarUpdatedAt`. Does double duty: it busts the cache
   * after a re-upload (the URL is otherwise unchanged), AND its presence is
   * what says a photo exists at all — omitted, this renders initials with
   * no request made.
   */
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
  // `version` is the subject's avatarUpdatedAt, which the server sets only
  // when a photo is actually uploaded — so its absence means there is no
  // photo to fetch, and this renders initials without touching the network.
  //
  // Without this check every row of every list fired an authenticated
  // request that 404'd: a 30-row chat list cost 30 round trips to render
  // the initials it was going to draw anyway, and each one held a socket
  // and a slot in the connection pool while doing it.
  if (!version) {
    return <InitialsCircle label={label} size={size} />;
  }
  if (userId) {
    return (
      <AvatarPhoto
        key={`u:${userId}:${version}`}
        cacheKey={`u-${userId}-${cacheSafe(version)}`}
        url={userAvatarUrl(userId, version)}
        label={label}
        size={size}
      />
    );
  }
  if (contactId) {
    return (
      <AvatarPhoto
        key={`c:${contactId}:${version}`}
        cacheKey={`c-${contactId}-${cacheSafe(version)}`}
        url={contactAvatarUrl(contactId, version)}
        label={label}
        size={size}
      />
    );
  }
  return <InitialsCircle label={label} size={size} />;
}

/** avatarUpdatedAt is an ISO string; colons and dots are not filenames. */
function cacheSafe(version: string): string {
  return version.replace(/[^a-zA-Z0-9]/g, '');
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '600' },
});
