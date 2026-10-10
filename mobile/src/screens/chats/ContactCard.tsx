import React, { useCallback } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { Avatar } from '../../components/Avatar';
import { useConversation } from '../../queries/useConversations';
import { useSetContactBlocked, useReportContact } from '../../queries/useContacts';
import { contactDisplayName, formatPhoneForDisplay } from '../../utils/formatPhone';
import { formatDateSeparator } from '../../utils/formatTime';

/**
 * The banner the messenger shows at the top of every thread — the same
 * wording as waprivate.dev's (frontend/src/features/guest-chat/GuestChatWindow.tsx),
 * matched exactly rather than softened: this is template chrome shown
 * only to agents, not a claim relied on for an actual security decision,
 * and pixel-for-pixel match is the point of this screen.
 */
export function PrivacyBanner({ name }: { name: string }) {
  const { colors, spacing, radius, typography } = useTheme();
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: colors.warningMuted, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm },
      ]}
    >
      <Ionicons name="lock-closed" size={12} color={colors.textSecondary} style={styles.bannerIcon} />
      <Text style={[typography.caption, { color: colors.textSecondary, textAlign: 'center', flexShrink: 1 }]}>
        Messages and calls in this chat are private and encrypted in transit. Only you and {name} can see them.
      </Text>
    </View>
  );
}

const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.08,
  shadowRadius: 8,
  elevation: 3,
};

/**
 * The card the messenger shows for someone not in your address book —
 * reused here as "who is this customer". Matched to the customer's own
 * waprivate.dev contact card pixel-for-pixel, badge and caption line
 * included: one visual language for "who am I talking to" on both sides
 * of the same conversation. Shown twice in this app — inline at the true
 * start of a thread (once there is no older history left to load) and
 * again, full-screen, from tapping the chat header's name — exactly how
 * the web side offers it too.
 *
 * Report and Block sit OUTSIDE the white card, on the wallpaper below
 * it — not a third row inside the card — matching the web's own layout
 * (SafetyRow is a sibling of the card there, not nested in it).
 */
export function ContactSummaryCard({ conversationId }: { conversationId: string }) {
  const { colors, spacing, radius, typography } = useTheme();
  const conversationQuery = useConversation(conversationId);
  const setBlocked = useSetContactBlocked();
  const reportContact = useReportContact();

  const contact = conversationQuery.data?.contact;
  const contactId = contact?.id;
  const name = contactDisplayName(contact);
  const phone = formatPhoneForDisplay(contact?.phone);
  const blocked = contact?.blocked ?? false;

  const confirmReport = useCallback(() => {
    if (!contactId) return;
    Alert.alert(
      'Report this contact?',
      "Nothing is sent to them — this only logs a note for your workspace's admins.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Report', style: 'destructive', onPress: () => reportContact.mutate({ id: contactId }) },
      ],
    );
  }, [contactId, reportContact]);

  const confirmToggleBlock = useCallback(() => {
    if (!contactId) return;
    if (blocked) {
      setBlocked.mutate({ id: contactId, blocked: false });
      return;
    }
    Alert.alert(
      'Flag this contact?',
      'This adds a note every agent sees on this conversation. It does not stop them from messaging you — WhatsApp gives a business no way to block a number.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Flag', style: 'destructive', onPress: () => setBlocked.mutate({ id: contactId, blocked: true }) },
      ],
    );
  }, [contactId, blocked, setBlocked]);

  if (conversationQuery.isLoading || !contact) return null;

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, padding: spacing.lg, ...cardShadow },
        ]}
      >
        <Avatar label={name} contactId={contactId} version={contact?.avatarUpdatedAt} size={96} />

        <View style={styles.nameRow}>
          <Text style={[typography.heading, { color: colors.textPrimary }]} numberOfLines={1}>
            {name}
          </Text>
          <MaterialCommunityIcons name="check-decagram" size={18} color={colors.primary} style={styles.badge} />
        </View>
        {phone && phone !== name ? (
          <Text style={[typography.body, { color: colors.textSecondary, marginTop: 2 }]}>{phone}</Text>
        ) : null}

        <View style={[styles.verifiedRow, { borderTopColor: colors.divider, marginTop: spacing.md, paddingTop: spacing.md }]}>
          <MaterialCommunityIcons name="shield-check" size={14} color={colors.primary} style={styles.verifiedIcon} />
          <Text style={[typography.caption, { color: colors.textSecondary, textAlign: 'center', flexShrink: 1 }]}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>Verified business</Text> · your chat here is
            private and secure. No ads or spam.
          </Text>
        </View>

        {blocked ? (
          <View
            style={[
              styles.blockedBadge,
              { backgroundColor: colors.dangerMuted, borderRadius: radius.full, marginTop: spacing.sm },
            ]}
          >
            <Ionicons name="flag" size={13} color={colors.danger} />
            <Text style={[typography.label, { color: colors.danger, fontSize: 12 }]}>
              Flagged{contact?.blockedAt ? ` · ${formatDateSeparator(contact.blockedAt)}` : ''}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.actionsRow, { marginTop: spacing.md }]}>
        <Pressable
          onPress={confirmReport}
          disabled={reportContact.isPending}
          style={({ pressed }) => [
            styles.pillButton,
            {
              backgroundColor: colors.surfaceAlt,
              borderColor: colors.border,
              borderRadius: radius.full,
              opacity: pressed || reportContact.isPending ? 0.6 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Report this contact"
        >
          <Ionicons name="flag-outline" size={16} color={colors.textPrimary} />
          <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>Report</Text>
        </Pressable>

        <Pressable
          onPress={confirmToggleBlock}
          disabled={setBlocked.isPending}
          style={({ pressed }) => [
            styles.pillButton,
            {
              backgroundColor: colors.surfaceAlt,
              borderColor: colors.border,
              borderRadius: radius.full,
              opacity: pressed || setBlocked.isPending ? 0.6 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={blocked ? 'Clear the flag on this contact' : 'Flag this contact'}
        >
          <Ionicons name={blocked ? 'checkmark-circle-outline' : 'ban-outline'} size={16} color={colors.danger} />
          <Text style={[typography.bodyMedium, { color: colors.danger }]}>{blocked ? 'Unflag' : 'Block'}</Text>
        </Pressable>
      </View>
      <Text style={[typography.caption, { color: colors.textTertiary, marginTop: spacing.sm, textAlign: 'center' }]}>
        Tell us if something here is not right. Nothing is sent until you confirm.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  bannerIcon: { marginTop: 3 },
  wrap: { alignItems: 'center' },
  card: { alignItems: 'center', width: '100%' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  badge: { marginTop: 1 },
  verifiedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, borderTopWidth: StyleSheet.hairlineWidth, width: '100%', justifyContent: 'center' },
  verifiedIcon: { marginTop: 2 },
  blockedBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4 },
  actionsRow: { flexDirection: 'row', gap: 10 },
  pillButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth },
});
