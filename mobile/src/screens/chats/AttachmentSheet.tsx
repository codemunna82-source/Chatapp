import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
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

type SendableMediaType = 'image' | 'video' | 'document';

/**
 * Pick → upload (POST /api/media/upload) → send (POST .../messages with the
 * returned mediaId). Every step is a real network call — no placeholder
 * "media coming soon" path (spec §21).
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
  const uploadMedia = useUploadMedia();
  const sendMessage = useSendMessage(conversationId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      onClose();
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

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    await submit({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream' }, 'document');
  };

  const options: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }[] = [
    { icon: 'image-outline', label: 'Photo or video library', onPress: pickFromLibrary },
    { icon: 'camera-outline', label: 'Camera', onPress: pickFromCamera },
    { icon: 'document-outline', label: 'Document', onPress: pickDocument },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={busy ? undefined : onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md }]}
          onPress={(e) => e.stopPropagation()}
        >
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
              {options.map((option) => (
                <Pressable
                  key={option.label}
                  style={[styles.row, { paddingVertical: spacing.sm }]}
                  onPress={option.onPress}
                >
                  <Ionicons name={option.icon} size={22} color={colors.primary} />
                  <Text style={[typography.body, { color: colors.textPrimary, marginLeft: spacing.sm }]}>{option.label}</Text>
                </Pressable>
              ))}
              <Pressable style={[styles.row, { paddingVertical: spacing.sm }]} onPress={onClose}>
                <Text style={[typography.body, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  sheet: { width: '100%' },
  row: { flexDirection: 'row', alignItems: 'center' },
  busy: { alignItems: 'center', padding: 16 },
});
