import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { SearchBar } from '../../components/SearchBar';
import { EmptyState } from '../../components/EmptyState';
import { Avatar } from '../../components/Avatar';
import { ContactFormSheet } from './ContactFormSheet';
import { useContacts, flattenContacts, useDeleteContact } from '../../queries/useContacts';
import { useDebouncedValue } from '../../utils/useDebouncedValue';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import { getApiErrorMessage } from '../../api/client';
import type { Contact } from '../../api/types';

/**
 * Contact management: edit, add, and select-to-delete (including select
 * all).
 *
 * Lives under Settings rather than in the tab bar — the Contacts tab was
 * removed in favour of the chat list's new-chat button, but contacts still
 * need somewhere to be managed.
 *
 * Deleting a contact also removes their conversations and messages from
 * this workspace (the server cascades), and cannot touch the customer's own
 * WhatsApp. The confirmation says so rather than implying a broader reach.
 */
export function ManageContactsScreen() {
  const { colors, spacing, typography } = useTheme();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useContacts({ search: debouncedSearch || undefined });
  const contacts = useMemo(() => flattenContacts(query.data), [query.data]);
  const deleteContact = useDeleteContact();

  const selectionMode = selectedIds.length > 0;
  const allSelected = contacts.length > 0 && selectedIds.length === contacts.length;

  const toggle = useCallback((contact: Contact) => {
    setSelectedIds((prev) => (prev.includes(contact.id) ? prev.filter((id) => id !== contact.id) : [...prev, contact.id]));
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => (prev.length === contacts.length ? [] : contacts.map((c) => c.id)));
  }, [contacts]);

  const handlePress = useCallback(
    (contact: Contact) => {
      if (selectionMode) {
        toggle(contact);
        return;
      }
      setEditing(contact);
      setFormOpen(true);
    },
    [selectionMode, toggle],
  );

  const runDelete = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Sequential: each delete cascades conversations and messages
      // server-side, and a failure part-way should stop rather than fire
      // the rest blindly.
      for (const id of selectedIds) {
        await deleteContact.mutateAsync(id);
      }
      setSelectedIds([]);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not delete those contacts.'));
    } finally {
      setBusy(false);
    }
  }, [selectedIds, deleteContact]);

  const confirmDelete = useCallback(() => {
    const count = selectedIds.length;
    Alert.alert(
      count === 1 ? 'Delete contact?' : `Delete ${count} contacts?`,
      "Their chats and messages are removed from VOXO too. This can't remove anything from the customer's own WhatsApp.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void runDelete() },
      ],
    );
  }, [selectedIds.length, runDelete]);

  const renderItem = useCallback(
    ({ item }: { item: Contact }) => {
      const label = item.name || item.phone;
      const selected = selectedIds.includes(item.id);
      return (
        <Pressable
          onPress={() => handlePress(item)}
          onLongPress={() => toggle(item)}
          disabled={busy}
          style={[styles.row, { paddingHorizontal: spacing.md, backgroundColor: selected ? colors.primaryMuted : 'transparent' }]}
          accessibilityRole="button"
          accessibilityState={{ selected: selectionMode ? selected : undefined }}
          accessibilityLabel={selectionMode ? `${selected ? 'Deselect' : 'Select'} ${label}` : `Edit ${label}`}
        >
          {({ pressed }) => (
            <View style={[styles.rowInner, { opacity: pressed ? 0.6 : 1 }]}>
              {selectionMode ? (
                <Ionicons
                  name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={selected ? colors.primary : colors.textTertiary}
                  style={{ marginRight: spacing.sm }}
                />
              ) : null}
              <Avatar label={label} size={42} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={1}>
                  {label}
                </Text>
                {item.name ? (
                  <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                    {item.phone}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
        </Pressable>
      );
    },
    [selectedIds, selectionMode, handlePress, toggle, busy, colors, spacing, typography],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search contacts" />

      <View style={[styles.bar, { paddingHorizontal: spacing.md }]}>
        {contacts.length > 0 ? (
          <Pressable onPress={toggleAll} style={styles.barAction} accessibilityRole="button" accessibilityLabel={allSelected ? 'Clear selection' : 'Select all contacts'}>
            <Ionicons
              name={allSelected ? 'checkbox' : 'square-outline'}
              size={18}
              color={allSelected ? colors.primary : colors.textSecondary}
            />
            <Text style={[typography.label, { color: allSelected ? colors.primary : colors.textSecondary, marginLeft: spacing.xs }]}>
              {allSelected ? 'Clear all' : 'Select all'}
            </Text>
          </Pressable>
        ) : (
          <View />
        )}

        {selectionMode ? (
          <Pressable onPress={confirmDelete} disabled={busy} style={styles.barAction} accessibilityRole="button" accessibilityLabel={`Delete ${selectedIds.length} selected contacts`}>
            {busy ? (
              <ActivityIndicator color={colors.danger} size="small" />
            ) : (
              <>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
                <Text style={[typography.label, { color: colors.danger, marginLeft: spacing.xs }]}>
                  Delete ({selectedIds.length})
                </Text>
              </>
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            style={styles.barAction}
            accessibilityRole="button"
            accessibilityLabel="Add a contact"
          >
            <Ionicons name="person-add-outline" size={18} color={colors.primary} />
            <Text style={[typography.label, { color: colors.primary, marginLeft: spacing.xs }]}>Add</Text>
          </Pressable>
        )}
      </View>

      {error ? (
        <Text style={[typography.caption, { color: colors.danger, paddingHorizontal: spacing.md, paddingBottom: 4 }]}>{error}</Text>
      ) : null}

      {query.isLoading ? null : contacts.length === 0 ? (
        <EmptyState
          icon={debouncedSearch ? 'search-outline' : 'people-outline'}
          title={debouncedSearch ? 'No contacts match your search' : 'No contacts yet'}
          subtitle={debouncedSearch ? 'Try a different name or number.' : 'Add a contact to start chatting with them.'}
        />
      ) : (
        <FlashList
          data={contacts}
          keyExtractor={(item: Contact) => item.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.primary} />}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ paddingBottom: spacing.lg }}
        />
      )}

      <ContactFormSheet visible={formOpen} contact={editing} onClose={() => setFormOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: touchTarget.compact },
  barAction: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget.compact, paddingHorizontal: 4 },
  row: { minHeight: touchTarget.min + 14, justifyContent: 'center' },
  rowInner: { flexDirection: 'row', alignItems: 'center' },
});
