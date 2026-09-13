import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Which slice of the inbox the list is showing.
 *
 * Deliberately not a boolean. "Read" is a filter in its own right, not
 * the absence of "unread" — and a third state has to exist anyway for
 * "show me everything", which is where the list starts.
 */
export type ChatFilter = 'all' | 'unread' | 'read';

const OPTIONS: { value: ChatFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'read', label: 'Read' },
];

/**
 * The row of pills under the search field.
 *
 * A plain row, not a horizontal ScrollView. It was one, and a horizontal
 * ScrollView inside a column stretches to fill the space below it — so
 * the three pills ended up floating in the middle of a third of the
 * screen, with the chat list pushed below all of it. Three pills fit on
 * every phone sold; wrapping is the right answer for the day a longer
 * label arrives, and it costs nothing until then.
 */
export function ChatListFilters({
  value,
  unreadCount,
  onChange,
}: {
  value: ChatFilter;
  /** Shown on the Unread pill, as the messenger does. Hidden at zero. */
  unreadCount: number;
  onChange: (next: ChatFilter) => void;
}) {
  const { colors, spacing, typography } = useTheme();

  return (
    <View style={[styles.row, { paddingHorizontal: spacing.md, gap: spacing.sm }]}>
      {OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.pill,
              {
                // The active pill is the accent at low opacity with the
                // accent's own text — the same pairing the messenger
                // uses, and the reason it reads as selected without a
                // border fighting the fill.
                backgroundColor: active ? colors.primaryMuted : colors.surfaceAlt,
                opacity: pressed ? 0.65 : 1,
              },
            ]}
          >
            <Text
              style={[
                typography.label,
                { color: active ? colors.success : colors.textSecondary },
              ]}
            >
              {option.label}
            </Text>
            {/* Only on Unread, only when there is one. A "0" beside the
                word would be an answer to a question nobody asked. */}
            {option.value === 'unread' && unreadCount > 0 ? (
              <View style={[styles.count, { backgroundColor: colors.success }]}>
                <Text style={[typography.caption, styles.countText]}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingBottom: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  count: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: '#FFFFFF', fontWeight: '700', fontSize: 11 },
});
