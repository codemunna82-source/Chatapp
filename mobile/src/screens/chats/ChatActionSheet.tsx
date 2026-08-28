import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import type { Conversation } from '../../api/types';

interface ChatActionSheetProps {
  /** The chat these actions apply to; null closes the sheet. */
  conversation: Conversation | null;
  onClose: () => void;
  onTogglePin: (conversation: Conversation) => void;
  onToggleArchive: (conversation: Conversation) => void;
  onDelete: (conversation: Conversation) => void;
}

/**
 * Long-press actions for a chat row — pin, archive and delete, the same set
 * WhatsApp offers from a long-press.
 *
 * Only these three: mute, lock, favourites, lists and block have no backing
 * capability in this app or in Meta's Cloud API, and a row that looks real
 * and does nothing is worse than its absence. Delete is workspace-local —
 * it removes the chat and its messages from VOXO, and cannot withdraw
 * anything from the customer's own WhatsApp.
 */
export function ChatActionSheet({ conversation, onClose, onTogglePin, onToggleArchive, onDelete }: ChatActionSheetProps) {
  const { colors, spacing, radius, typography } = useTheme();
  if (!conversation) return null;

  const label = conversation.contact?.name || conversation.contact?.phone || 'this chat';
  const isArchived = conversation.status === 'ARCHIVED';

  const actions = [
    {
      key: 'pin',
      label: conversation.pinned ? 'Unpin' : 'Pin',
      icon: (conversation.pinned ? 'pin-outline' : 'pin') as keyof typeof Ionicons.glyphMap,
      tint: colors.textPrimary,
      onPress: () => onTogglePin(conversation),
    },
    {
      key: 'archive',
      label: isArchived ? 'Unarchive' : 'Archive',
      icon: (isArchived ? 'arrow-undo-outline' : 'archive-outline') as keyof typeof Ionicons.glyphMap,
      tint: colors.textPrimary,
      onPress: () => onToggleArchive(conversation),
    },
    {
      key: 'delete',
      label: 'Delete chat',
      icon: 'trash-outline' as keyof typeof Ionicons.glyphMap,
      tint: colors.danger,
      onPress: () => onDelete(conversation),
    },
  ];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.background, borderRadius: radius.lg }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text
            style={[typography.label, { color: colors.textSecondary, paddingHorizontal: spacing.md, paddingTop: spacing.md }]}
            numberOfLines={1}
          >
            {label}
          </Text>

          {actions.map((action) => (
            <Pressable
              key={action.key}
              onPress={action.onPress}
              style={[styles.row, { borderTopColor: colors.border, paddingHorizontal: spacing.md }]}
              accessibilityRole="button"
              accessibilityLabel={action.label}
            >
              {({ pressed }) => (
                <View style={[styles.rowInner, { opacity: pressed ? 0.6 : 1 }]}>
                  <Ionicons name={action.icon} size={20} color={action.tint} />
                  <Text style={[typography.body, { color: action.tint, marginLeft: spacing.md }]}>{action.label}</Text>
                </View>
              )}
            </Pressable>
          ))}

          <Pressable
            onPress={onClose}
            style={[styles.row, { borderTopColor: colors.border, paddingHorizontal: spacing.md }]}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <View style={styles.rowInner}>
              <Text style={[typography.body, { color: colors.textSecondary }]}>Cancel</Text>
            </View>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  sheet: { width: '100%' },
  row: { borderTopWidth: StyleSheet.hairlineWidth, minHeight: touchTarget.min, justifyContent: 'center' },
  rowInner: { flexDirection: 'row', alignItems: 'center' },
});
