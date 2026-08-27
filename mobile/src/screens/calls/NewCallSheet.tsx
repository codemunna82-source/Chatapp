import React, { useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { InlineBanner } from '../../components/InlineBanner';
import { SearchBar } from '../../components/SearchBar';
import { useTheme } from '../../theme/ThemeProvider';
import { useContacts, flattenContacts } from '../../queries/useContacts';
import { useDebouncedValue } from '../../utils/useDebouncedValue';
import { usePlaceCall } from '../../queries/useCalls';
import { getApiErrorMessage } from '../../api/client';
import type { Contact } from '../../api/types';

interface NewCallSheetProps {
  visible: boolean;
  onClose: () => void;
}

/** Contact picker → POST /api/calls → hands off to the real WhatsApp app. */
export function NewCallSheet({ visible, onClose }: NewCallSheetProps) {
  const { colors, spacing, radius, typography } = useTheme();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const contactsQuery = useContacts({ search: debouncedSearch || undefined });
  const contacts = flattenContacts(contactsQuery.data);
  const { placeCall, isPending, apiError, linkError } = usePlaceCall();

  const error = apiError ? getApiErrorMessage(apiError, 'Could not start that call.') : linkError;

  const handlePick = async (contact: Contact) => {
    const opened = await placeCall(contact.id);
    if (opened) onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Same keyboard-avoidance gap as the other Modal-based sheets — the
          search field sits right where the keyboard would otherwise cover it. */}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={isPending ? undefined : onClose}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[typography.heading, { color: colors.textPrimary, marginBottom: spacing.sm }]}>Call a contact</Text>
            <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing.md }]}>
              Opens the real WhatsApp app on this device to place the call.
            </Text>

            {error ? <InlineBanner message={error} /> : null}

            <View style={{ marginHorizontal: -spacing.md }}>
              <SearchBar value={search} onChangeText={setSearch} placeholder="Search contacts" />
            </View>

            {isPending ? (
              <View style={styles.centered}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <FlatList
                data={contacts}
                keyExtractor={(item) => item.id}
                style={styles.list}
                renderItem={({ item }) => (
                  <Pressable
                    style={[styles.row, { paddingVertical: spacing.sm, borderBottomColor: colors.border }]}
                    onPress={() => handlePick(item)}
                  >
                    <Avatar label={item.name || item.phone} size={36} />
                    <View style={{ marginLeft: spacing.sm }}>
                      <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{item.name || item.phone}</Text>
                      {item.name ? (
                        <Text style={[typography.caption, { color: colors.textSecondary }]}>{item.phone}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                )}
                ListEmptyComponent={
                  !contactsQuery.isLoading ? (
                    <Text style={[typography.body, { color: colors.textSecondary, paddingVertical: spacing.md }]}>
                      No contacts found.
                    </Text>
                  ) : null
                }
              />
            )}

            <Pressable style={[styles.cancel, { paddingVertical: spacing.sm }]} onPress={onClose} disabled={isPending}>
              <Text style={[typography.body, { color: colors.textSecondary }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  sheet: { width: '100%', maxHeight: '75%' },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  centered: { alignItems: 'center', padding: 16 },
  cancel: { alignItems: 'center' },
});
