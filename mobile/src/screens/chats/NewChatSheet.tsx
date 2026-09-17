import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppBottomSheet, type AppBottomSheetRef } from '../../components/AppBottomSheet';
import { Avatar } from '../../components/Avatar';
import { SearchBar } from '../../components/SearchBar';
import { ContactFormSheet } from '../contacts/ContactFormSheet';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import { useContacts, flattenContacts, useDeleteContacts } from '../../queries/useContacts';
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
  /**
   * Selection mode, WhatsApp's: a header control turns it on, a long
   * press turns it on with that row already ticked, and every tap
   * afterwards ticks instead of opening.
   *
   * It replaced a trash button on every row. One-at-a-time was the wrong
   * shape for what this list is actually used for: an agent cannot open a
   * chat from here at all until the customer has written in, so the
   * contacts that accumulate are ones nobody will ever tap — and clearing
   * them one confirmation at a time is the work, not the deleting.
   */
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const deleteContacts = useDeleteContacts();
  const deleting = deleteContacts.isPending;

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelectedIds([]);
  }, []);

  const toggleSelected = useCallback((contact: Contact) => {
    setSelectedIds((prev) =>
      prev.includes(contact.id) ? prev.filter((id) => id !== contact.id) : [...prev, contact.id],
    );
  }, []);

  const startSelection = useCallback((contact: Contact) => {
    setSelecting(true);
    setSelectedIds([contact.id]);
  }, []);

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

  /**
   * Removing the selected contacts from the workspace.
   *
   * Confirmed, and the confirmation says plainly that the chats go with
   * them — because they do: the server deletes each contact's
   * conversations and every message in them (contact.service.ts). That is
   * not obvious from a button labelled "delete", and it cannot be undone,
   * so it is spelled out before rather than discovered after.
   *
   * Only VOXO's copy. The customers' own WhatsApp threads are untouched —
   * nothing can recall what Meta has already delivered.
   *
   * The count is in the title because it is the one thing that makes this
   * different from the old one-row button, and a tap meant for a tick
   * that lands on delete should say "37 contacts" loudly enough to stop
   * the next tap.
   */
  const handleDeleteSelected = useCallback(() => {
    const ids = selectedIds;
    if (ids.length === 0 || deleting) return;
    const many = ids.length > 1;
    Alert.alert(
      many ? `Delete ${ids.length} contacts?` : 'Delete this contact?',
      (many
        ? 'This removes these contacts AND every chat with them — every message, from this app only. '
        : 'This removes the contact AND the whole chat with them — every message, from this app only. ') +
        'Their own WhatsApp is not affected. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteContacts.mutate(ids, {
              onSuccess: ({ failed }) => {
                if (failed > 0) {
                  Alert.alert(
                    'Some were not deleted',
                    `${failed} of ${ids.length} could not be deleted. The rest are gone.`,
                  );
                }
              },
              onError: (err) => {
                Alert.alert('Not deleted', getApiErrorMessage(err, 'Could not delete those contacts.'));
              },
              onSettled: exitSelection,
            });
          },
        },
      ],
    );
  }, [selectedIds, deleting, deleteContacts, exitSelection]);

  const renderItem = useCallback(
    ({ item }: { item: Contact }) => {
      const label = item.name || item.phone;
      const ticked = selectedIds.includes(item.id);
      return (
        <Pressable
          onPress={() => (selecting ? toggleSelected(item) : handlePick(item))}
          onLongPress={() => (selecting ? toggleSelected(item) : startSelection(item))}
          disabled={Boolean(openingId) || deleting}
          style={[styles.row, { paddingHorizontal: spacing.lg }]}
          accessibilityRole={selecting ? 'checkbox' : 'button'}
          accessibilityState={selecting ? { checked: ticked } : undefined}
          accessibilityLabel={selecting ? label : `Start a chat with ${label}`}
        >
          {({ pressed }) => (
            <View style={[styles.rowInner, { opacity: pressed ? 0.6 : 1 }]}>
              <Avatar label={label} contactId={item.id} version={item.avatarUpdatedAt} size={42} />
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

              {/* The tick, and nothing else. A delete control on the row
                  as well would give two ways to destroy a chat from one
                  list, one of them a single tap. */}
              {selecting ? (
                <Ionicons
                  name={ticked ? 'checkmark-circle' : 'ellipse-outline'}
                  size={24}
                  color={ticked ? colors.primary : colors.textTertiary}
                />
              ) : null}
            </View>
          )}
        </Pressable>
      );
    },
    [
      handlePick,
      openingId,
      selecting,
      selectedIds,
      toggleSelected,
      startSelection,
      deleting,
      colors,
      spacing,
      typography,
    ],
  );

  return (
    <>
      {/* Selection is cleared on the way out, not by an effect watching
          `visible`: reopening the sheet to find rows still ticked from
          last time is a delete waiting to happen, and the sheet's own
          dismiss is the one event that covers both ways it can close. */}
      <AppBottomSheet
        ref={sheetRef}
        snapPoints={SNAP_POINTS}
        onDismiss={() => {
          exitSelection();
          onClose();
        }}
      >
        <View style={[styles.header, { paddingHorizontal: spacing.lg }]}>
          {selecting ? (
            <>
              <Pressable
                onPress={exitSelection}
                disabled={deleting}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Cancel selection"
              >
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </Pressable>
              <Text style={[typography.heading, { color: colors.textPrimary, flex: 1, marginLeft: spacing.md }]}>
                {selectedIds.length === 0 ? 'Select contacts' : `${selectedIds.length} selected`}
              </Text>
              {deleting ? (
                <ActivityIndicator color={colors.danger} size="small" />
              ) : (
                <Pressable
                  onPress={handleDeleteSelected}
                  disabled={selectedIds.length === 0}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${selectedIds.length} selected contacts and their chats`}
                >
                  <Ionicons
                    name="trash-outline"
                    size={22}
                    // Dimmed rather than hidden with nothing selected: a
                    // control that appears only once you have guessed the
                    // gesture is a control nobody finds.
                    color={selectedIds.length === 0 ? colors.textTertiary : colors.danger}
                  />
                </Pressable>
              )}
            </>
          ) : (
            <>
              <Text style={[typography.heading, { color: colors.textPrimary, flex: 1 }]}>New chat</Text>
              <Pressable
                onPress={() => setSelecting(true)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Select contacts to delete"
              >
                <Ionicons name="checkmark-circle-outline" size={24} color={colors.textSecondary} />
              </Pressable>
            </>
          )}
        </View>

        <View style={{ marginHorizontal: -spacing.md }}>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search contacts" />
        </View>

        {/* Out of the way while selecting: the row sits where the first
            contact would be, and a tap meant for a tick opening a blank
            contact form loses the selection behind it. */}
        {selecting ? null : (
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
        )}

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
  header: { flexDirection: 'row', alignItems: 'center' },
  list: { flex: 1 },
  row: { minHeight: touchTarget.min + 12, justifyContent: 'center' },
  rowInner: { flexDirection: 'row', alignItems: 'center' },
  newContactIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  centered: { alignItems: 'center', padding: 24 },
});
