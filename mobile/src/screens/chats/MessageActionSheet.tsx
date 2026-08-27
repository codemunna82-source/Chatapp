import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

interface MessageActionSheetProps {
  visible: boolean;
  canReact: boolean;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
}

/** Long-press action sheet — spec §19's reply + reactions, one shared entry point for both. */
export function MessageActionSheet({ visible, canReact, onClose, onReact, onReply }: MessageActionSheetProps) {
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
                <Pressable key={emoji} onPress={() => onReact(emoji)} hitSlop={8}>
                  <Text style={styles.emoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Pressable
            style={[styles.actionRow, { borderTopColor: colors.border, paddingVertical: spacing.sm }]}
            onPress={onReply}
          >
            <Text style={[typography.body, { color: colors.textPrimary }]}>Reply</Text>
          </Pressable>
          <Pressable style={[styles.actionRow, { paddingVertical: spacing.sm }]} onPress={onClose}>
            <Text style={[typography.body, { color: colors.textSecondary }]}>Cancel</Text>
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
  emoji: { fontSize: 28 },
  actionRow: { borderTopWidth: StyleSheet.hairlineWidth },
});
