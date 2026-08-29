import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import type { Message } from '../../api/types';

interface MessageInfoSheetProps {
  message: Message | null;
  onClose: () => void;
}

function formatFull(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString(
    undefined,
    { hour: 'numeric', minute: '2-digit' },
  )}`;
}

/**
 * When each delivery milestone happened for one outgoing message.
 *
 * Exists because "delivered" without a time cannot answer the question
 * people actually ask, which is whether the customer had the message before
 * or after they complained about not getting it.
 *
 * A milestone with no timestamp is shown as explicitly not-yet-reached
 * rather than hidden. "Read — not yet" is an answer; an absent row looks
 * like the feature is broken, and the most common reason Read never arrives
 * is that the customer turned read receipts off, which is worth saying out
 * loud rather than leaving someone to wonder.
 */
export function MessageInfoSheet({ message, onClose }: MessageInfoSheetProps) {
  const { colors, spacing, radius, typography } = useTheme();
  if (!message) return null;

  const rows = [
    {
      key: 'sent',
      label: 'Sent',
      icon: 'checkmark' as keyof typeof Ionicons.glyphMap,
      at: formatFull(message.sentAt),
    },
    {
      key: 'delivered',
      label: 'Delivered',
      icon: 'checkmark-done' as keyof typeof Ionicons.glyphMap,
      at: formatFull(message.deliveredAt),
    },
    {
      key: 'read',
      label: 'Read',
      icon: 'checkmark-done' as keyof typeof Ionicons.glyphMap,
      at: formatFull(message.readAt),
    },
  ];

  const failed = message.status === 'FAILED';
  const readMissing = !message.readAt && Boolean(message.deliveredAt);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[typography.heading, { color: colors.textPrimary, marginBottom: spacing.sm }]}>
            Message info
          </Text>

          {message.text ? (
            <Text
              style={[
                typography.body,
                {
                  color: colors.textSecondary,
                  backgroundColor: colors.surfaceAlt,
                  borderRadius: radius.md,
                  padding: spacing.sm,
                  marginBottom: spacing.md,
                },
              ]}
              numberOfLines={3}
            >
              {message.text}
            </Text>
          ) : null}

          {failed ? (
            <View style={[styles.row, { paddingVertical: spacing.sm }]}>
              <Ionicons name="alert-circle" size={20} color={colors.danger} />
              <Text style={[typography.body, { color: colors.danger, marginLeft: spacing.md }]}>
                Failed to send
              </Text>
            </View>
          ) : (
            rows.map((row) => (
              <View
                key={row.key}
                style={[styles.row, { paddingVertical: spacing.sm, borderTopColor: colors.divider }]}
              >
                <Ionicons
                  name={row.icon}
                  size={18}
                  color={row.at ? (row.key === 'read' ? colors.primary : colors.textSecondary) : colors.textTertiary}
                />
                <Text style={[typography.body, { color: colors.textPrimary, marginLeft: spacing.md, flex: 1 }]}>
                  {row.label}
                </Text>
                <Text style={[typography.caption, { color: row.at ? colors.textSecondary : colors.textTertiary }]}>
                  {row.at ?? 'Not yet'}
                </Text>
              </View>
            ))
          )}

          {readMissing ? (
            <Text style={[typography.caption, { color: colors.textTertiary, marginTop: spacing.sm }]}>
              No read receipt yet. WhatsApp only reports this when the customer has read receipts turned on.
            </Text>
          ) : null}

          <Pressable
            onPress={onClose}
            style={[styles.closeRow, { borderTopColor: colors.border, paddingVertical: spacing.sm }]}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={[typography.body, { color: colors.textSecondary }]}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, minHeight: touchTarget.compact },
  closeRow: { borderTopWidth: StyleSheet.hairlineWidth, alignItems: 'center', marginTop: 8 },
});
