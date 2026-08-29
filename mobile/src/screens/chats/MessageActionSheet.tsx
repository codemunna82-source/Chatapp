import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

interface MessageActionSheetProps {
  visible: boolean;
  canReact: boolean;
  /** Only text-bearing messages can be copied. */
  canCopy: boolean;
  /** Text and media messages can be forwarded; reactions and templates can't. */
  canForward: boolean;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onForward: () => void;
  onCopy: () => void;
  /** Whether this message can start a multi-message selection. */
  canSelect: boolean;
  /** Current star state — the row is a toggle, so it has to read as one. */
  starred: boolean;
  /** Reactions and not-yet-sent optimistic messages can't be starred. */
  canStar: boolean;
  onToggleStar: () => void;
  onSelectMore: () => void;
  onDelete: () => void;
}

/**
 * Long-press action sheet — reactions, reply, forward, copy, star and
 * delete from one entry point.
 *
 * (An earlier version of this comment said there was deliberately no
 * Delete row, because the backend had no delete endpoint. It has one now —
 * DELETE /conversations/:id/messages/:messageId — and the row below is
 * "Delete for me" only, for the reason given at that row.)
 */
export function MessageActionSheet({
  visible,
  canReact,
  canCopy,
  canForward,
  onClose,
  onReact,
  onReply,
  onForward,
  onCopy,
  canSelect,
  starred,
  canStar,
  onToggleStar,
  onSelectMore,
  onDelete,
}: MessageActionSheetProps) {
  const { colors, spacing, radius, typography } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md }]}
          onPress={(e) => e.stopPropagation()}
        >
          {canReact ? (
            <View style={[styles.emojiRow, { marginBottom: spacing.md }]}>
              {QUICK_EMOJIS.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => onReact(emoji)}
                  style={styles.emojiButton}
                  accessibilityRole="button"
                  accessibilityLabel={`React with ${emoji}`}
                >
                  {({ pressed }) => <Text style={[styles.emoji, { opacity: pressed ? 0.5 : 1 }]}>{emoji}</Text>}
                </Pressable>
              ))}
            </View>
          ) : null}

          {(
            [
              { key: 'reply', label: 'Reply', icon: 'arrow-undo-outline', onPress: onReply, enabled: true },
              { key: 'forward', label: 'Forward', icon: 'arrow-redo-outline', onPress: onForward, enabled: canForward },
              { key: 'copy', label: 'Copy', icon: 'copy-outline', onPress: onCopy, enabled: canCopy },
              {
                key: 'star',
                label: starred ? 'Unstar' : 'Star',
                icon: starred ? 'star' : 'star-outline',
                onPress: onToggleStar,
                enabled: canStar,
              },
              {
                key: 'select',
                label: 'Select more',
                icon: 'checkmark-circle-outline',
                onPress: onSelectMore,
                enabled: canSelect,
              },
              // "Delete for me" only. Meta's Cloud API has no delete or
              // recall endpoint, so a delete-for-everyone would clear the
              // message here while the customer still saw it in WhatsApp.
              { key: 'delete', label: 'Delete for me', icon: 'trash-outline', onPress: onDelete, enabled: true },
            ] as const
          )
            .filter((action) => action.enabled)
            .map((action) => (
              <Pressable
                key={action.key}
                style={[styles.actionRow, { borderTopColor: colors.border, paddingVertical: spacing.sm }]}
                onPress={action.onPress}
                accessibilityRole="button"
                accessibilityLabel={action.label}
              >
                {({ pressed }) => (
                  <View style={[styles.actionInner, { opacity: pressed ? 0.6 : 1 }]}>
                    <Ionicons
                      name={action.icon}
                      size={20}
                      color={action.key === 'delete' ? colors.danger : colors.textSecondary}
                    />
                    <Text
                      style={[
                        typography.body,
                        { color: action.key === 'delete' ? colors.danger : colors.textPrimary, marginLeft: spacing.md },
                      ]}
                    >
                      {action.label}
                    </Text>
                  </View>
                )}
              </Pressable>
            ))}
          <Pressable
            style={[styles.actionRow, { borderTopColor: colors.border, paddingVertical: spacing.sm }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <View style={styles.actionInner}>
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
  emojiRow: { flexDirection: 'row', justifyContent: 'space-between' },
  emojiButton: { width: touchTarget.min, height: touchTarget.min, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 28 },
  actionRow: { borderTopWidth: StyleSheet.hairlineWidth, minHeight: touchTarget.compact, justifyContent: 'center' },
  actionInner: { flexDirection: 'row', alignItems: 'center' },
});
