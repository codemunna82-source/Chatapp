import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { Avatar } from '../../components/Avatar';
import { InlineBanner } from '../../components/InlineBanner';
import { useTheme } from '../../theme/ThemeProvider';
import { useCreateContact, useUpdateContact, useUploadContactAvatar } from '../../queries/useContacts';
import { getApiErrorMessage } from '../../api/client';
import { selectionFeedback, notifySuccess } from '../../utils/haptics';
import { saveContactToPhone, describeSaveResult, type SaveToPhoneResult } from '../../utils/deviceContacts';
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

/**
 * The contact's photo, tappable to replace it.
 *
 * This is the workspace's own picture of the customer, not a sync: Meta's
 * Cloud API exposes no way to read someone's WhatsApp profile photo, so
 * there is nothing to pull down. Only offered while editing an existing
 * contact — a photo needs a contact id to upload against.
 */
function ContactPhotoPicker({ contact }: { contact: Contact }) {
  const { colors, spacing, typography } = useTheme();
  const upload = useUploadContactAvatar();
  const [pickError, setPickError] = useState<string | null>(null);

  const pick = async () => {
    if (upload.isPending) return;
    setPickError(null);
    selectionFeedback();
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setPickError('Photo access is needed to set a picture.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      upload.mutate({
        id: contact.id,
        file: {
          uri: asset.uri,
          name: asset.fileName ?? 'contact-photo.jpg',
          mimeType: asset.mimeType ?? 'image/jpeg',
        },
      });
    } catch {
      setPickError('Could not open the photo library.');
    }
  };

  const error = pickError ?? (upload.error ? getApiErrorMessage(upload.error, 'Could not upload this photo.') : null);

  return (
    <View style={{ alignItems: 'center', marginBottom: spacing.md }}>
      <Pressable onPress={pick} accessibilityRole="button" accessibilityLabel="Change contact photo">
        <Avatar
          label={contact.name || contact.phone}
          contactId={contact.id}
          version={contact.avatarUpdatedAt}
          size={84}
        />
        <View style={[styles.photoBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
          {upload.isPending ? (
            <ActivityIndicator size="small" color={colors.textOnPrimary} />
          ) : (
            <Ionicons name="camera" size={15} color={colors.textOnPrimary} />
          )}
        </View>
      </Pressable>
      <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        Tap to change photo
      </Text>
      {error ? <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>{error}</Text> : null}
    </View>
  );
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
  const { colors, spacing, radius, typography } = useTheme();
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const isEdit = Boolean(contact);

  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [name, setName] = useState(contact?.name ?? '');
  const [tagsText, setTagsText] = useState(contact?.tags.join(', ') ?? '');
  const [phoneBookNote, setPhoneBookNote] = useState<string | null>(null);
  const [savingToPhone, setSavingToPhone] = useState(false);

  const mutation = isEdit ? updateContact : createContact;
  const error = mutation.error ? getApiErrorMessage(mutation.error, 'Could not save this contact.') : null;

  /**
   * Mirrors the contact into the phone's own address book.
   *
   * Deliberately not fire-and-forget-silent: it asks for a permission and
   * writes to something outside the app, so the user is told what happened
   * either way. A refusal is reported and then dropped — the VOXO contact
   * is already saved, and failing that too would be punishing the user for
   * saying no.
   */
  const mirrorToPhone = async (target: { name?: string; phone: string }): Promise<SaveToPhoneResult> => {
    setSavingToPhone(true);
    try {
      const result = await saveContactToPhone(target);
      setPhoneBookNote(describeSaveResult(result));
      if (result === 'saved') notifySuccess();
      return result;
    } finally {
      setSavingToPhone(false);
    }
  };

  const handleSave = () => {
    const tags = parseTags(tagsText);
    if (isEdit && contact) {
      updateContact.mutate({ id: contact.id, name: name.trim() || undefined, tags }, { onSuccess: onClose });
    } else {
      const trimmedPhone = phone.trim();
      const trimmedName = name.trim() || undefined;
      createContact.mutate(
        { phone: trimmedPhone, name: trimmedName, tags },
        {
          onSuccess: () => {
            // The sheet closes straight away — the VOXO contact is saved
            // and that is what the user pressed the button for. The
            // address-book write continues on its own; the system
            // permission dialog is its own visible feedback, and a second
            // one for an already-present number would be noise.
            onClose();
            void saveContactToPhone({ name: trimmedName, phone: trimmedPhone });
          },
        },
      );
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={[typography.heading, { color: colors.textPrimary, marginBottom: spacing.md }]}>
        {isEdit ? 'Edit contact' : 'New contact'}
      </Text>

      {error ? <InlineBanner message={error} /> : null}

      {isEdit && contact ? <ContactPhotoPicker contact={contact} /> : null}

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

      {isEdit && contact ? (
        <Pressable
          onPress={() => {
            if (savingToPhone) return;
            selectionFeedback();
            void mirrorToPhone({ name: name.trim() || contact.name, phone: contact.phone });
          }}
          style={[
            styles.phoneBookRow,
            { borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md },
          ]}
        >
          <Ionicons name="person-add-outline" size={18} color={colors.primary} />
          <Text style={[typography.body, { color: colors.textPrimary, flex: 1, marginLeft: spacing.sm }]}>
            Save to phone contacts
          </Text>
          {savingToPhone ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </Pressable>
      ) : null}

      {phoneBookNote ? (
        <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
          {phoneBookNote}
        </Text>
      ) : null}

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
      {/* Plain RN Modal doesn't auto-resize for the keyboard the way the
          main screen does — without this, typing into a lower field (e.g.
          Tags) on a shorter device hides it behind the keyboard entirely. */}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md }]}
            onPress={(e) => e.stopPropagation()}
          >
            {visible ? <ContactFormBody contact={contact} onClose={onClose} /> : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxHeight: '85%' },
  actions: { flexDirection: 'row', marginTop: 8 },
  phoneBookRow: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  photoBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
