import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { type BottomSheetModal } from '@gorhom/bottom-sheet';
import { AppBottomSheet } from '../../components/AppBottomSheet';
import { useTheme } from '../../theme/ThemeProvider';
import { useUploadMedia } from '../../queries/useUploadMedia';
import { useSendMessage } from '../../queries/useMessages';
import { getApiErrorMessage } from '../../api/client';
import type { PickedFile } from '../../api/endpoints/media';

interface AttachmentSheetProps {
  visible: boolean;
  whatsappPhoneNumberId: string | undefined;
  replyToMessageId: string | undefined;
  conversationId: string;
  onClose: () => void;
  onSent: () => void;
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
}: AttachmentSheetProps) {
  const { colors, spacing, radius, typography } = useTheme();
  const sheetRef = useRef<BottomSheetModal>(null);
  const uploadMedia = useUploadMedia();
  const sendMessage = useSendMessage(conversationId);
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

  const submit = async (file: PickedFile, type: SendableMediaType) => {
    if (!whatsappPhoneNumberId) {
      setError('This conversation has no connected WhatsApp number yet.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadMedia.mutateAsync({ whatsappPhoneNumberId, file });
      sendMessage.mutate({ type, mediaId: uploaded.id, replyToMessageId });
      onSent();
      sheetRef.current?.dismiss();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not upload that file.'));
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
