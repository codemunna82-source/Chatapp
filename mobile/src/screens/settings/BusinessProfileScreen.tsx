import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { InlineBanner } from '../../components/InlineBanner';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import {
  useRemoveBusinessAvatar,
  useTenantSettings,
  useUpdateBusinessProfile,
  useUploadBusinessAvatar,
} from '../../queries/useTenantSettings';
import { AvatarPhoto } from '../../components/Avatar';
import { businessAvatarUrl, type BusinessNameSource } from '../../api/endpoints/tenant';
import { userAvatarUrl } from '../../api/endpoints/users';
import { avatarCacheName } from '../../media/avatarCache';
import { getApiErrorMessage } from '../../api/client';

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
  const uploadAvatar = useUploadBusinessAvatar();
  const removeAvatar = useRemoveBusinessAvatar();

  /**
   * Setting the workspace's photo.
   *
   * The web chat window had a name and a coloured circle with a letter in
   * it, so every business looked the same to the stranger deciding
   * whether to keep talking. This is where that photo comes from, and it
   * sits on the preview rather than in a row of its own: the thing being
   * changed is what the customer sees, and it is right there.
   */
  const pickPhoto = useCallback(async () => {
    if (uploadAvatar.isPending) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // Square, because it is drawn in a circle everywhere it appears.
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;

    uploadAvatar.mutate(
      {
        uri: asset.uri,
        // The picker can return a uri with no filename at all; multipart
        // still requires one, and the mime type does the real work.
        name: asset.fileName ?? 'business.jpg',
        mimeType: asset.mimeType ?? 'image/jpeg',
      },
      { onError: (err) => Alert.alert('Could not update the photo', getApiErrorMessage(err)) },
    );
  }, [uploadAvatar]);

  const confirmRemovePhoto = useCallback(() => {
    Alert.alert('Remove photo?', 'Customers will see your initials instead.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          removeAvatar.mutate(undefined, {
            onError: (err) => Alert.alert('Could not remove the photo', getApiErrorMessage(err)),
          }),
      },
    ]);
  }, [removeAvatar]);

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
  // Indexed defensively: a source this build has no copy for — one added
  // to the server later — must not take the screen down.
  const source = SOURCE_COPY[data.customerFacingNameSource] ?? SOURCE_COPY.fallback;
  const displayName = draft ?? data.displayName;
  const dirty = displayName.trim() !== data.displayName;

  /**
   * The photo the customer is actually shown, and where to fetch it.
   *
   * Two different authenticated routes depending on whose it is, which is
   * why this is resolved here rather than by passing a version around:
   * the workspace's own has its own endpoint, and a member's is the
   * ordinary user-avatar one this app already reads everywhere else.
   */
  const facing = data.customerFacingAvatar;
  const shown = facing
    ? facing.source === 'workspace'
      ? {
          url: businessAvatarUrl(facing.version),
          cacheKey: avatarCacheName('u', 'business', facing.version),
        }
      : facing.userId
        ? {
            url: userAvatarUrl(facing.userId, facing.version),
            cacheKey: avatarCacheName('u', facing.userId, facing.version),
          }
        : null
    : null;

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
            {/* Tappable, and it says so: a picture with no affordance
                round it reads as decoration, and the only other way to
                set one would be a row somewhere else that never mentions
                the preview it changes. */}
            <Pressable
              onPress={() => void pickPhoto()}
              onLongPress={data.avatarUpdatedAt ? confirmRemovePhoto : undefined}
              accessibilityRole="button"
              accessibilityLabel={
                data.avatarUpdatedAt ? 'Change your business photo' : 'Add a business photo'
              }
              style={[styles.avatarWrap, { marginRight: spacing.sm }]}
            >
              {/* Whatever the CUSTOMER sees, which is not always the
                  workspace's own photo — with none set the window shows
                  the profile picture of the person answering the number.
                  Showing the workspace's here instead would make this
                  preview a preview of something else. */}
              {shown ? (
                <AvatarPhoto
                  // Remounted per photo, so a new upload starts from a
                  // clean state rather than showing the previous one.
                  key={shown.cacheKey}
                  url={shown.url}
                  cacheKey={shown.cacheKey}
                  label={data.customerFacingName}
                  size={40}
                />
              ) : (
                <View style={[styles.avatar, { backgroundColor: colors.primary, borderRadius: 20 }]}>
                  <Text style={[typography.bodyMedium, { color: colors.textOnPrimary }]}>
                    {data.customerFacingName.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              {uploadAvatar.isPending || removeAvatar.isPending ? (
                <View style={[styles.avatarBusy, { backgroundColor: colors.overlay }]}>
                  <ActivityIndicator size="small" color={colors.textOnPrimary} />
                </View>
              ) : (
                <View style={[styles.avatarBadge, { backgroundColor: colors.primary }]}>
                  <Ionicons name="camera" size={11} color={colors.textOnPrimary} />
                </View>
              )}
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={1}>
                {data.customerFacingName}
              </Text>
              <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={2}>
                {data.avatarUpdatedAt
                  ? 'online · hold the photo to remove it'
                  : facing?.source === 'member'
                    ? // Says WHOSE photo this is. Without it, someone who
                      // never set a workspace photo sees one anyway and
                      // has no idea where it came from or how to change
                      // it.
                      'online · using your VOXO profile picture — tap to set a different one'
                    : 'online · tap the circle to add a photo'}
              </Text>
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
  avatarWrap: { width: 40, height: 40 },
  // Bottom-right of the circle, the way every app marks a photo you can
  // change.
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBusy: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceRow: { flexDirection: 'row', alignItems: 'flex-start' },
});
