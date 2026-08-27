import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { InlineBanner } from '../../components/InlineBanner';
import { useTheme } from '../../theme/ThemeProvider';
import { useCreateContact, useUpdateContact } from '../../queries/useContacts';
import { getApiErrorMessage } from '../../api/client';
import type { Contact } from '../../api/types';

interface ContactFormSheetProps {
  visible: boolean;
  contact: Contact | null; // null = create mode, otherwise edit mode
  onClose: () => void;
}

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

interface ContactFormBodyProps {
  contact: Contact | null;
  onClose: () => void;
}

/**
 * Mounted only while the sheet is visible (see ContactFormSheet below), so
 * its fields start fresh from `contact` on every open via lazy initial
 * state — no effect-driven reset needed.
 */
function ContactFormBody({ contact, onClose }: ContactFormBodyProps) {
  const { colors, spacing, typography } = useTheme();
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const isEdit = Boolean(contact);

  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [name, setName] = useState(contact?.name ?? '');
  const [tagsText, setTagsText] = useState(contact?.tags.join(', ') ?? '');

  const mutation = isEdit ? updateContact : createContact;
  const error = mutation.error ? getApiErrorMessage(mutation.error, 'Could not save this contact.') : null;

  const handleSave = () => {
    const tags = parseTags(tagsText);
    if (isEdit && contact) {
      updateContact.mutate({ id: contact.id, name: name.trim() || undefined, tags }, { onSuccess: onClose });
    } else {
      createContact.mutate({ phone: phone.trim(), name: name.trim() || undefined, tags }, { onSuccess: onClose });
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={[typography.heading, { color: colors.textPrimary, marginBottom: spacing.md }]}>
        {isEdit ? 'Edit contact' : 'New contact'}
      </Text>

      {error ? <InlineBanner message={error} /> : null}

      {isEdit ? (
        <View style={{ marginBottom: spacing.md }}>
          <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>Phone</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>{contact?.phone}</Text>
        </View>
      ) : (
        <TextField
          label="Phone (E.164, e.g. +14155551234)"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoCapitalize="none"
        />
      )}

      <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
      <TextField label="Tags (comma-separated)" value={tagsText} onChangeText={setTagsText} autoCapitalize="none" />

      <View style={styles.actions}>
        <View style={{ flex: 1, marginRight: spacing.sm }}>
          <Button label="Cancel" variant="secondary" onPress={onClose} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Save"
            onPress={handleSave}
            loading={mutation.isPending}
            disabled={!isEdit && phone.trim().length === 0}
          />
        </View>
      </View>
    </ScrollView>
  );
}

/** One sheet for both create and edit — phone is only editable (and required) on create; Meta identifies a contact by phone, so it isn't patchable afterward. */
export function ContactFormSheet({ visible, contact, onClose }: ContactFormSheetProps) {
  const { colors, spacing, radius } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md }]}
          onPress={(e) => e.stopPropagation()}
        >
          {visible ? <ContactFormBody contact={contact} onClose={onClose} /> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxHeight: '85%' },
  actions: { flexDirection: 'row', marginTop: 8 },
});
