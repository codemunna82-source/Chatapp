import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { AppBottomSheet, type AppBottomSheetRef } from '../../components/AppBottomSheet';
import { useTheme } from '../../theme/ThemeProvider';
import { useUploadMedia } from '../../queries/useUploadMedia';
import { useQueryClient } from '@tanstack/react-query';
import {
  useSendMessage,
  insertPendingMediaMessage,
  removeMessageFromCache,
  patchUploadProgressInCache,
} from '../../queries/useMessages';
import { getApiErrorMessage } from '../../api/client';
import type { PickedFile } from '../../api/endpoints/media';

interface AttachmentSheetProps {
  visible: boolean;
  whatsappPhoneNumberId: string | undefined;
  replyToMessageId: string | undefined;
  conversationId: string;
  onClose: () => void;
  onSent: () => void;
  /** Reported by the screen, since the sheet has closed by the time an
   *  optimistic upload can fail. */
  onUploadFailed?: (message: string) => void;
}

type SendableMediaType = 'image' | 'video' | 'document' | 'audio';

/**
 * Pick → upload (POST /api/media/upload) → send (POST .../messages with the
 * returned mediaId). Every step is a real network call — no placeholder
 * "media coming soon" path (spec §21).
 *
 * Deliberately no "Location" or "Contact" option: neither is backed by any
 * real capability in this app (no location picker, no device-contacts
 * bridge, and the backend has nowhere to put either) — adding those buttons
 * would look real and do nothing, which is exactly what was asked not to do.
 */
export function AttachmentSheet({
  visible,
  whatsappPhoneNumberId,
  replyToMessageId,
  conversationId,
  onClose,
  onSent,
  onUploadFailed,
}: AttachmentSheetProps) {
  const { colors, spacing, radius, typography } = useTheme();
  const sheetRef = useRef<AppBottomSheetRef>(null);
  const uploadMedia = useUploadMedia();
  const sendMessage = useSendMessage(conversationId);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  // A real event callback from the sheet itself (fires once it's actually
  // open), not a React effect — the correct place to clear a stale error
  // from a previous open.
  const handleSheetChange = (index: number) => {
    if (index >= 0) setError(null);
  };

  /**
   * Pick, then get out of the way.
   *
   * This used to hold the sheet open with a spinner across the whole
   * upload — so sending a video meant staring at a covered chat for as
   * long as the bytes took, with no way to tell progress from a stall and
   * nothing else usable in the meantime. Every messenger does the
   * opposite: the sheet closes, the bubble appears at once, and the
   * upload draws its progress on that bubble.
   *
   * A document has no thumbnail to draw on, so it keeps the blocking
   * spinner — a bubble for a file that may fail to upload, with nothing
   * in it to look at, would be worse than the wait.
   */
  const submit = async (file: PickedFile, type: SendableMediaType) => {
    if (!whatsappPhoneNumberId) {
      setError('This conversation has no connected WhatsApp number yet.');
      return;
    }
    setError(null);

    const optimistic = type === 'image' || type === 'video';
    const tempId = `local-attach-${Date.now()}`;

    if (optimistic) {
      insertPendingMediaMessage(queryClient, conversationId, {
        tempId,
        type,
        localUri: file.uri,
        replyToMessageId,
      });
      onSent();
      sheetRef.current?.dismiss();
    } else {
      setBusy(true);
    }

    try {
      const uploaded = await uploadMedia.mutateAsync({
        whatsappPhoneNumberId,
        file,
        onProgress: optimistic
          ? (fraction) => patchUploadProgressInCache(queryClient, conversationId, tempId, fraction)
          : undefined,
      });
      // The real send brings its own optimistic entry, so ours goes first
      // rather than leaving two bubbles for one attachment.
      if (optimistic) removeMessageFromCache(queryClient, conversationId, tempId);
      sendMessage.mutate({ type, mediaId: uploaded.id, replyToMessageId });
      if (!optimistic) {
        onSent();
        sheetRef.current?.dismiss();
      }
    } catch (err) {
      // With the sheet already gone there is nowhere to show an error
      // inside it, so the bubble is removed and the screen's own media
      // error surface carries the message.
      if (optimistic) {
        removeMessageFromCache(queryClient, conversationId, tempId);
        onUploadFailed?.(getApiErrorMessage(err, 'Could not send that.'));
      } else {
        setError(getApiErrorMessage(err, 'Could not upload that file.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const pickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.8 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    const type: SendableMediaType = asset.type === 'video' ? 'video' : 'image';
    await submit(
      { uri: asset.uri, name: asset.fileName ?? `attachment.${type === 'video' ? 'mp4' : 'jpg'}`, mimeType: asset.mimeType ?? (type === 'video' ? 'video/mp4' : 'image/jpeg') },
      type,
    );
  };

  const pickFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Camera permission was denied.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    await submit({ uri: asset.uri, name: asset.fileName ?? 'photo.jpg', mimeType: asset.mimeType ?? 'image/jpeg' }, 'image');
  };

  const pickAudioFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    await submit({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'audio/mpeg' }, 'audio');
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    // An audio file picked through the generic document option still gets
    // tagged as a real 'audio' message (so it renders with the inline
    // player) instead of a generic file chip — matched by mime, not faked.
    const type: SendableMediaType = asset.mimeType?.startsWith('audio/') ? 'audio' : 'document';
    await submit({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream' }, type);
  };

  const options: { icon: keyof typeof Ionicons.glyphMap; label: string; tint: string; muted: string; onPress: () => void }[] = [
    { icon: 'images-outline', label: 'Gallery', tint: colors.primary, muted: colors.primaryMuted, onPress: pickFromLibrary },
    { icon: 'camera-outline', label: 'Camera', tint: colors.danger, muted: colors.dangerMuted, onPress: pickFromCamera },
    { icon: 'document-outline', label: 'Document', tint: colors.warning, muted: colors.warningMuted, onPress: pickDocument },
    { icon: 'musical-notes-outline', label: 'Audio', tint: colors.success, muted: colors.successMuted, onPress: pickAudioFile },
  ];

  return (
    <AppBottomSheet ref={sheetRef} snapPoints={SNAP_POINTS} onDismiss={onClose} onChange={handleSheetChange}>
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, paddingTop: spacing.xs }}>
        <Text style={[typography.heading, { color: colors.textPrimary, marginBottom: spacing.md }]}>Share</Text>

        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.sm }]}>Uploading…</Text>
          </View>
        ) : (
          <>
            {error ? (
              <Text style={[typography.caption, { color: colors.danger, marginBottom: spacing.sm }]}>{error}</Text>
            ) : null}
            <View style={styles.grid}>
              {/* Each option's onPress closure eventually reads sheetRef.current
                  (via submit()'s dismiss-on-success), but only once actually
                  invoked as an event handler — never during this render pass.
                  eslint-plugin-react-hooks' "refs" check can't yet trace that
                  the ref access is deferred behind an async callback boundary,
                  hence the disable. */}
              {/* eslint-disable-next-line react-hooks/refs */}
              {options.map((option) => (
                <Pressable key={option.label} onPress={option.onPress} style={styles.gridItem}>
                  <View style={[styles.iconCircle, { backgroundColor: option.muted, borderRadius: radius.full }]}>
                    <Ionicons name={option.icon} size={24} color={option.tint} />
                  </View>
                  <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>
    </AppBottomSheet>
  );
}

// Title + one row of four options; a real height rather than dynamic
// sizing, which presented at zero height on device.
const SNAP_POINTS = ['34%'];

const styles = StyleSheet.create({
  busy: { alignItems: 'center', padding: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridItem: { width: '25%', alignItems: 'center', marginBottom: 16 },
  iconCircle: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});
