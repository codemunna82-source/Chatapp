import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { mediaUrl } from '../../api/endpoints/media';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../theme/ThemeProvider';
import type { MessageType } from '../../api/types';

const ICONS: Partial<Record<MessageType, keyof typeof Ionicons.glyphMap>> = {
  document: 'document-text-outline',
  video: 'videocam-outline',
  audio: 'musical-notes-outline',
};

const LABELS: Partial<Record<MessageType, string>> = {
  document: 'Document',
  video: 'Video',
  audio: 'Audio',
};

/**
 * Downloads the file (through the authenticated media proxy) to a local
 * cache path, then hands it to the system share/open sheet — a genuinely
 * working way to view a video/audio/document without building a custom
 * in-app player for every format Meta can deliver.
 */
export function MediaFileChip({
  mediaId,
  type,
  onLongPress,
}: {
  mediaId: string;
  type: MessageType;
  /** Forwarded to the chip's Pressable — see MediaImage for why. */
  onLongPress?: () => void;
}) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { colors, spacing, radius, typography } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const handlePress = async () => {
    // Re-entrancy guard, standing in for the `disabled` prop this
    // Pressable used to carry: a disabled Pressable stops responding to
    // everything, long-press included, which took the action sheet away
    // for as long as a download was running.
    if (busy) return;
    setError(false);
    setBusy(true);
    try {
      const destination = new File(Paths.cache, `voxo-media-${mediaId}`);
      const result = await File.downloadFileAsync(mediaUrl(mediaId), destination, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        idempotent: true,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri);
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={onLongPress}
      style={[styles.row, { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: spacing.sm }]}
    >
      {busy ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Ionicons name={ICONS[type] ?? 'document-outline'} size={22} color={colors.primary} />
      )}
      <View style={{ marginLeft: spacing.sm }}>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{LABELS[type] ?? 'File'}</Text>
        <Text style={[typography.caption, { color: error ? colors.danger : colors.textSecondary }]}>
          {error ? 'Failed to open — tap to retry' : 'Tap to open'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minWidth: 180 },
});
