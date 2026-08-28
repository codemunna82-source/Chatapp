import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppBottomSheet, type AppBottomSheetRef } from '../../components/AppBottomSheet';
import { Avatar } from '../../components/Avatar';
import { SearchBar } from '../../components/SearchBar';
import { ContactFormSheet } from '../contacts/ContactFormSheet';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import { useContacts, flattenContacts } from '../../queries/useContacts';
import { useStartConversation } from '../../queries/useConversations';
import { useDebouncedValue } from '../../utils/useDebouncedValue';
import { getApiErrorMessage } from '../../api/client';
import type { Contact } from '../../api/types';

interface NewChatSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called with the conversation id once a chat has been opened for the picked contact. */
  onOpenConversation: (conversationId: string) => void;
}

const SNAP_POINTS = ['72%'];

/**
 * The "new chat" flow: pick a contact, and the chat with them opens —
 * creating the conversation server-side the first time (POST
 * /api/conversations, idempotent per contact).
 *
 * This is also where contacts are created now that the Contacts tab is
 * gone, so the list is never a dead end when the workspace has no contacts
 * yet or the person being looked for isn't in it.
 */
export function NewChatSheet({ visible, onClose, onOpenConversation }: NewChatSheetProps) {
  const { colors, spacing, typography } = useTheme();
  const sheetRef = useRef<AppBottomSheetRef>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [contactFormOpen, setContactFormOpen] = useState(false);

  const contactsQuery = useContacts({ search: debouncedSearch || undefined });
  const contacts = useMemo(() => flattenContacts(contactsQuery.data), [contactsQuery.data]);
  const startConversation = useStartConversation();

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  const handlePick = useCallback(
    async (contact: Contact) => {
      if (openingId) return;
      setOpeningId(contact.id);
      setError(null);
      try {
        const conversation = await startConversation.mutateAsync(contact.id);
        sheetRef.current?.dismiss();
        onOpenConversation(conversation.id);
      } catch (err) {
        setError(getApiErrorMessage(err, 'Could not start that chat.'));
      } finally {
        setOpeningId(null);
      }
    },
    [openingId, startConversation, onOpenConversation],
  );

  const renderItem = useCallback(
    ({ item }: { item: Contact }) => {
      const label = item.name || item.phone;
      return (
        <Pressable
          onPress={() => handlePick(item)}
          disabled={Boolean(openingId)}
          style={[styles.row, { paddingHorizontal: spacing.lg }]}
          accessibilityRole="button"
          accessibilityLabel={`Start a chat with ${label}`}
        >
          {({ pressed }) => (
            <View style={[styles.rowInner, { opacity: pressed ? 0.6 : 1 }]}>
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
              {openingId === item.id ? <ActivityIndicator color={colors.primary} size="small" /> : null}
            </View>
          )}
        </Pressable>
      );
    },
    [handlePick, openingId, colors, spacing, typography],
  );

  return (
    <>
      <AppBottomSheet ref={sheetRef} snapPoints={SNAP_POINTS} onDismiss={onClose}>
        <View style={{ paddingHorizontal: spacing.lg }}>
          <Text style={[typography.heading, { color: colors.textPrimary }]}>New chat</Text>
        </View>

        <View style={{ marginHorizontal: -spacing.md }}>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search contacts" />
        </View>

        <Pressable
          onPress={() => setContactFormOpen(true)}
          style={[styles.row, { paddingHorizontal: spacing.lg }]}
          accessibilityRole="button"
          accessibilityLabel="Add a new contact"
        >
          {({ pressed }) => (
            <View style={[styles.rowInner, { opacity: pressed ? 0.6 : 1 }]}>
              <View style={[styles.newContactIcon, { backgroundColor: colors.primaryMuted }]}>
                <Ionicons name="person-add" size={20} color={colors.primary} />
              </View>
              <Text style={[typography.bodyMedium, { color: colors.primary, marginLeft: spacing.md }]}>New contact</Text>
            </View>
          )}
        </Pressable>

        {error ? (
          <Text style={[typography.caption, { color: colors.danger, paddingHorizontal: spacing.lg, paddingBottom: 4 }]}>
            {error}
          </Text>
        ) : null}

        {contactsQuery.isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : contacts.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="people-outline" size={28} color={colors.textTertiary} />
            <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' }]}>
              {debouncedSearch ? 'No contacts match that search.' : 'No contacts yet — add one to start chatting.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={contacts}
            keyExtractor={(item: Contact) => item.id}
            renderItem={renderItem}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: spacing.xl }}
            onEndReached={() => {
              if (contactsQuery.hasNextPage && !contactsQuery.isFetchingNextPage) {
                contactsQuery.fetchNextPage();
              }
            }}
            onEndReachedThreshold={0.5}
          />
        )}
      </AppBottomSheet>

      {/* Contact creation lives here now that the Contacts tab is gone. */}
      <ContactFormSheet visible={contactFormOpen} contact={null} onClose={() => setContactFormOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  row: { minHeight: touchTarget.min + 12, justifyContent: 'center' },
  rowInner: { flexDirection: 'row', alignItems: 'center' },
  newContactIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  centered: { alignItems: 'center', padding: 24 },
});
