import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { type BottomSheetModal } from '@gorhom/bottom-sheet';
import { AppBottomSheet } from '../../components/AppBottomSheet';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import { useRecentEmojiStore } from '../../store/recentEmojiStore';
import { EMOJI_CATEGORIES, searchEmoji, type EmojiEntry } from '../../data/emojiData';

const RECENTS_KEY = 'recents';
const NUM_COLUMNS = 8;

interface EmojiPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (char: string) => void;
}

/**
 * A real categorized emoji grid + recents + keyword search (spec §6) — a
 * plain BottomSheetFlatList of Unicode characters, not a system dialog and
 * not a mocked-up static image.
 */
export function EmojiPicker({ visible, onClose, onSelect }: EmojiPickerProps) {
  const { colors, spacing, radius, typography } = useTheme();
  const sheetRef = useRef<BottomSheetModal>(null);
  const [activeCategory, setActiveCategory] = useState(EMOJI_CATEGORIES[0]?.key ?? RECENTS_KEY);
  const [query, setQuery] = useState('');
  const recents = useRecentEmojiStore((s) => s.recents);
  const addRecent = useRecentEmojiStore((s) => s.addRecent);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  // A real event callback from the sheet itself, not a React effect —
  // clears the search once it's actually finished closing (index -1).
  const handleSheetChange = (index: number) => {
    if (index < 0) setQuery('');
  };

  const tabs = useMemo(
    () => [{ key: RECENTS_KEY, label: 'Recent', icon: '🕒' }, ...EMOJI_CATEGORIES.map((c) => ({ key: c.key, label: c.label, icon: c.icon }))],
    [],
  );

  const gridData: EmojiEntry[] = useMemo(() => {
    if (query.trim()) return searchEmoji(query);
    if (activeCategory === RECENTS_KEY) return recents.map((char) => ({ char, keywords: [] }));
    return EMOJI_CATEGORIES.find((c) => c.key === activeCategory)?.entries ?? [];
  }, [query, activeCategory, recents]);

  const handlePick = (char: string) => {
    addRecent(char);
    onSelect(char);
  };

  return (
    <AppBottomSheet ref={sheetRef} snapPoints={['62%']} onDismiss={onClose} onChange={handleSheetChange}>
      <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>
        <View style={[styles.searchRow, { backgroundColor: colors.surfaceAlt, borderRadius: radius.full, paddingHorizontal: spacing.sm }]}>
          <Ionicons name="search" size={16} color={colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search emoji"
            placeholderTextColor={colors.textTertiary}
            style={[typography.body, { flex: 1, color: colors.textPrimary, marginLeft: spacing.xs, paddingVertical: 8 }]}
          />
        </View>

        {!query.trim() ? (
          <View style={[styles.tabRow, { marginTop: spacing.sm }]}>
            {tabs.map((tab) => (
              <Pressable
                key={tab.key}
                onPress={() => setActiveCategory(tab.key)}
                style={[
                  styles.tab,
                  {
                    backgroundColor: activeCategory === tab.key ? colors.primaryMuted : 'transparent',
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Text style={styles.tabIcon}>{tab.icon}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {gridData.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            {query.trim() ? 'No emoji found.' : "No recent emoji yet — the ones you use will show up here."}
          </Text>
        </View>
      ) : (
        <BottomSheetFlatList
          data={gridData}
          key={activeCategory + (query.trim() ? 'search' : '')}
          keyExtractor={(item: EmojiEntry, index: number) => `${item.char}-${index}`}
          numColumns={NUM_COLUMNS}
          style={styles.grid}
          contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.lg }}
          renderItem={({ item }: { item: EmojiEntry }) => (
            <Pressable onPress={() => handlePick(item.char)} style={styles.emojiCell}>
              <Text style={styles.emojiChar}>{item.char}</Text>
            </Pressable>
          )}
        />
      )}
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  grid: { flex: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center' },
  tabRow: { flexDirection: 'row', justifyContent: 'space-between' },
  tab: { width: touchTarget.compact, height: touchTarget.compact, alignItems: 'center', justifyContent: 'center' },
  tabIcon: { fontSize: 18 },
  empty: { alignItems: 'center', padding: 24 },
  emojiCell: { width: `${100 / NUM_COLUMNS}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  emojiChar: { fontSize: 26 },
});
