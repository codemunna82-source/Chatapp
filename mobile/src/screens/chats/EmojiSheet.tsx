import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';

/**
 * A short, ordinary set — not an emoji keyboard.
 *
 * The phone already has one of those, and it opens with the text field.
 * What it does NOT give you is the handful you actually send in a
 * business chat without hunting through categories, which is what this
 * is: the reactions, the acknowledgements, the two or three that end a
 * message. Grouped roughly so the eye can skip, not labelled — labels on
 * six rows of pictures are more chrome than content.
 */
const EMOJI = [
  '😀', '😄', '😊', '🙂', '😉', '😍', '🥰', '😘',
  '😎', '🤩', '🤔', '🙃', '😅', '😂', '🤣', '😇',
  '👍', '👎', '🙏', '👏', '💪', '🤝', '👌', '✌️',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🔥', '✨',
  '✅', '❌', '⚠️', '❗', '❓', '💯', '🎉', '🎁',
  '📞', '📱', '📧', '📍', '🕒', '📅', '💰', '🧾',
  '🚀', '📦', '🛒', '💳', '🏠', '🚗', '☕', '🍽️',
  '😢', '😭', '😡', '😴', '🤒', '🙌', '👋', '💬',
];

interface EmojiSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Appends to the draft — the composer owns the text, this only offers. */
  onPick: (emoji: string) => void;
}

export function EmojiSheet({ visible, onClose, onPick }: EmojiSheetProps) {
  const { colors, spacing, radius, typography } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* The scrim closes it. A sheet you can only leave by finding a
          small × is a sheet people back out of the whole screen from. */}
      <Pressable style={[styles.scrim, { backgroundColor: colors.overlay }]} onPress={onClose} />

      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surfaceElevated,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            paddingHorizontal: spacing.md,
            paddingBottom: spacing.lg,
          },
        ]}
      >
        <View style={[styles.header, { paddingVertical: spacing.sm }]}>
          <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>Emoji</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            {({ pressed }) => (
              <Ionicons name="close" size={22} color={colors.textSecondary} style={{ opacity: pressed ? 0.5 : 1 }} />
            )}
          </Pressable>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.grid}
          // The sheet is a fixed height, so this is the one place that
          // scrolls; without it the grid would push the sheet off screen.
          style={styles.gridScroll}
        >
          {EMOJI.map((emoji) => (
            <Pressable
              key={emoji}
              // Stays open on purpose: people send three in a row more
              // often than one, and reopening the sheet each time is the
              // whole cost of using it.
              onPress={() => onPick(emoji)}
              style={({ pressed }) => [styles.cell, pressed && { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm }]}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${emoji}`}
            >
              <Text style={styles.glyph}>{emoji}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  sheet: { maxHeight: '52%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gridScroll: { flexGrow: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 8}%`,
    height: touchTarget.compact,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 26 },
});
