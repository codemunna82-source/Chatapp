import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { InlineBanner } from '../../components/InlineBanner';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { useTenantSettings, useUpdateBusinessProfile } from '../../queries/useTenantSettings';
import type { BusinessNameSource } from '../../api/endpoints/tenant';

/**
 * Where the customer-facing name is coming from, said plainly.
 *
 * The point of this screen is that an admin can see what a stranger reads
 * at the top of the web chat window. Showing the name without saying where
 * it came from would leave them unable to tell a deliberate setting from a
 * fallback they never chose — which is exactly how "Demo Tenant" went out
 * to real customers in the first place.
 */
const SOURCE_COPY: Record<BusinessNameSource, { text: string; tone: 'ok' | 'warn' }> = {
  settings: { text: 'This is the name you set below.', tone: 'ok' },
  whatsapp: { text: 'Taken from your WhatsApp number’s approved display name.', tone: 'ok' },
  workspace: { text: 'Falling back to your workspace name, because nothing else is set.', tone: 'warn' },
  fallback: {
    text: 'Nothing is set, so customers just see “Support”. Enter your business name below.',
    tone: 'warn',
  },
};

export function BusinessProfileScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const settings = useTenantSettings();
  const update = useUpdateBusinessProfile();

  /**
   * What has been typed, or null while the field is still showing the
   * saved value.
   *
   * Deliberately not an effect that copies the query into state: that
   * pattern re-seeds the field on every refetch, which on this screen
   * means overwriting what the admin is halfway through typing the moment
   * a background refresh lands. Null means "show what is saved", and the
   * save handler resets it to null so the field follows the server again.
   */
  const [draft, setDraft] = useState<string | null>(null);

  if (settings.isPending) return <LoadingIndicator />;

  if (settings.isError) {
    return (
      <Screen>
        <InlineBanner message="Could not load your workspace settings. Pull back and try again." />
      </Screen>
    );
  }

  const data = settings.data;
  const source = SOURCE_COPY[data.customerFacingNameSource];
  const displayName = draft ?? data.displayName;
  const dirty = displayName.trim() !== data.displayName;

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing.md }]}>
          When a customer opens the private chat link you send them, this is the name they see at the top of
          the window and on any notification from you.
        </Text>

        {/* What the customer sees right now — the whole reason for the
            screen. Shown before the field, because an admin opening this
            is answering "what does my customer see?" first and "what do I
            type?" second. */}
        <View
          style={[
            styles.preview,
            { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
          ]}
        >
          <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
            CUSTOMERS SEE
          </Text>
          <View style={styles.previewRow}>
            <View
              style={[
                styles.avatar,
                { backgroundColor: colors.primary, borderRadius: 20, marginRight: spacing.sm },
              ]}
            >
              <Text style={[typography.bodyMedium, { color: colors.textOnPrimary }]}>
                {data.customerFacingName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={1}>
                {data.customerFacingName}
              </Text>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>online</Text>
            </View>
          </View>
          <View style={[styles.sourceRow, { marginTop: spacing.sm }]}>
            <Ionicons
              name={source.tone === 'ok' ? 'checkmark-circle' : 'alert-circle'}
              size={15}
              color={source.tone === 'ok' ? colors.success : colors.warning}
            />
            <Text
              style={[
                typography.caption,
                { color: colors.textSecondary, marginLeft: spacing.xs, flex: 1 },
              ]}
            >
              {source.text}
            </Text>
          </View>
        </View>

        <TextField
          label="Business name"
          value={displayName}
          onChangeText={setDraft}
          placeholder={data.whatsappVerifiedName || 'e.g. RK Enterprises'}
          maxLength={120}
          autoCapitalize="words"
          returnKeyType="done"
        />
        <Text
          style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing.md, marginTop: -spacing.xs }]}
        >
          {data.whatsappVerifiedName
            ? `Leave this empty to use the name WhatsApp has approved for your number — “${data.whatsappVerifiedName}”.`
            : 'Leave this empty once WhatsApp approves a display name for your number, and that name will be used instead.'}
        </Text>

        {update.isError ? <InlineBanner message="Could not save. Check your connection and try again." /> : null}
        {update.isSuccess && !dirty ? <InlineBanner message="Saved. Customers see this name now." tone="success" /> : null}

        <Button
          label="Save"
          onPress={() =>
            update.mutate(
              { displayName: displayName.trim() },
              // Back to following the server: the hook writes the saved
              // values into the cache, and the field should show those
              // rather than the string that was typed to get them.
              { onSuccess: () => setDraft(null) },
            )
          }
          loading={update.isPending}
          disabled={!dirty}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: {},
  previewRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  sourceRow: { flexDirection: 'row', alignItems: 'flex-start' },
});
