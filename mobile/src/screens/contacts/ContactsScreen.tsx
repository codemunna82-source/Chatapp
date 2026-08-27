import React, { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { SearchBar } from '../../components/SearchBar';
import { SkeletonBlock } from '../../components/Skeleton';
import { ContactListItem } from './ContactListItem';
import { ContactFormSheet } from './ContactFormSheet';
import { useContacts, flattenContacts } from '../../queries/useContacts';
import { useDebouncedValue } from '../../utils/useDebouncedValue';
import { useTheme } from '../../theme/ThemeProvider';
import type { Contact } from '../../api/types';

export function ContactsScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const query = useContacts({ search: debouncedSearch || undefined });
  const contacts = flattenContacts(query.data);

  const showSkeleton = query.isLoading;
  const showEmpty = !showSkeleton && contacts.length === 0;

  const openCreate = () => {
    setEditingContact(null);
    setSheetOpen(true);
  };
  const openEdit = (contact: Contact) => {
    setEditingContact(contact);
    setSheetOpen(true);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search contacts" />
        </View>
        <Pressable
          onPress={openCreate}
          hitSlop={8}
          style={[styles.addButton, { backgroundColor: colors.primary, borderRadius: radius.full, marginRight: spacing.md }]}
        >
          <Ionicons name="add" size={22} color={colors.textOnPrimary} />
        </Pressable>
      </View>

      {showSkeleton ? (
        <View style={{ padding: spacing.md }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonBlock key={i} style={{ height: 56, marginBottom: spacing.sm, borderRadius: radius.sm }} />
          ))}
        </View>
      ) : showEmpty ? (
        <View style={styles.empty}>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            {debouncedSearch ? 'No contacts match your search.' : 'No contacts yet — tap + to add one.'}
          </Text>
        </View>
      ) : (
        <FlashList
          data={contacts}
          keyExtractor={(item: Contact) => item.id}
          renderItem={({ item }: { item: Contact }) => <ContactListItem contact={item} onPress={() => openEdit(item)} />}
          refreshControl={
            <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.primary} />
          }
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) {
              query.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ paddingBottom: spacing.lg }}
        />
      )}

      <ContactFormSheet visible={sheetOpen} contact={editingContact} onClose={() => setSheetOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  addButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
});
