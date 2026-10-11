import React, { useCallback } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from '../../navigation/types';
import { Screen } from '../../components/Screen';
import { ThemeProvider, useTheme, useResolvedScheme } from '../../theme/ThemeProvider';
import { chatLightColors, chatDarkColors, chatHeaderBackground, chatHeaderForeground } from '../../theme/chatTheme';
import { useConversation } from '../../queries/useConversations';
import { useGuestLinkStatus, useIssueGuestLink, useRevokeGuestLink } from '../../queries/useGuestChat';
import { getApiErrorMessage } from '../../api/client';
import { contactDisplayName } from '../../utils/formatPhone';
import { PrivacyBanner, ContactSummaryCard } from './ContactCard';

type Props = NativeStackScreenProps<ChatsStackParamList, 'ContactInfo'>;

/**
 * This one customer's own private-chat link, mintable and copyable here —
 * never shown in bulk anywhere, and never with anything but the real
 * random token in it (see guest.service.ts's issueGuestLinkForConversation:
 * a phone number in its place would let anyone who knows or guesses a
 * customer's number open their private chat with no login at all).
 *
 * A fresh session can only be minted when none is already live — the
 * plaintext token is returned once, at creation, and never stored, so an
 * existing session has no URL left to show (see guestSession.repository.ts).
 * Replacing it is offered, exactly like the composer's own SMS hand-off:
 * an explicit choice, because it stops every older copy of the link
 * working.
 */
function PrivateChatLinkRow({ conversationId }: { conversationId: string }) {
  const { colors, spacing, radius, typography } = useTheme();
  const guestLinkQuery = useGuestLinkStatus(conversationId);
  const issueGuestLink = useIssueGuestLink(conversationId);
  const revokeGuestLink = useRevokeGuestLink(conversationId);
  const guestActive = guestLinkQuery.data?.active ?? false;
  const busy = issueGuestLink.isPending || revokeGuestLink.isPending;

  const copyAndConfirm = useCallback((url: string) => {
    void Clipboard.setStringAsync(url);
    Alert.alert('Link copied', 'The private chat link has been copied to your clipboard.');
  }, []);

  const handlePress = useCallback(() => {
    if (busy) return;

    const create = () => {
      issueGuestLink.mutate(undefined, {
        onSuccess: (link) => copyAndConfirm(link.url),
        onError: (err) => Alert.alert('Could not create link', getApiErrorMessage(err)),
      });
    };

    if (!guestActive) {
      create();
      return;
    }

    // The URL of a live link cannot be shown again — only its hash is
    // stored — so the honest offer is to replace it, which is also what
    // makes every copy already sent stop working.
    Alert.alert(
      'A link is already active',
      'The existing link cannot be shown again. Creating a new one will stop the old link working.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'New link',
          style: 'destructive',
          onPress: () =>
            revokeGuestLink.mutate(undefined, {
              onSuccess: create,
              onError: (err) => Alert.alert('Could not replace link', getApiErrorMessage(err)),
            }),
        },
      ],
    );
  }, [busy, guestActive, issueGuestLink, revokeGuestLink, copyAndConfirm]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={busy}
      style={({ pressed }) => [
        styles.linkRow,
        {
          backgroundColor: colors.surfaceAlt,
          borderRadius: radius.lg,
          borderColor: colors.border,
          padding: spacing.md,
          opacity: pressed || busy ? 0.6 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel="Copy this customer's private chat link"
    >
      <Ionicons name="link-outline" size={20} color={colors.primary} />
      <View style={styles.linkTextWrap}>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>Private chat link</Text>
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
          {guestActive ? 'A link is already active · tap to replace and copy' : 'Tap to create and copy'}
        </Text>
      </View>
    </Pressable>
  );
}

function ContactInfoBody({ conversationId }: { conversationId: string }) {
  const { spacing } = useTheme();
  const conversationQuery = useConversation(conversationId);
  const name = contactDisplayName(conversationQuery.data?.contact);
  return (
    <ScrollView contentContainerStyle={[styles.scrollContent, { padding: spacing.md }]}>
      <PrivacyBanner name={name} />
      <ContactSummaryCard conversationId={conversationId} />
      <View style={{ marginTop: spacing.md, width: '100%' }}>
        <PrivateChatLinkRow conversationId={conversationId} />
      </View>
    </ScrollView>
  );
}

export function ContactInfoScreen({ route, navigation }: Props) {
  const { conversationId } = route.params;
  const scheme = useResolvedScheme();
  const chatColors = scheme === 'dark' ? chatDarkColors : chatLightColors;

  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Contact info',
      headerStyle: { backgroundColor: chatHeaderBackground[scheme] },
      headerTintColor: chatHeaderForeground[scheme],
      headerTitleStyle: { color: chatHeaderForeground[scheme] },
    });
  }, [navigation, scheme]);

  return (
    <ThemeProvider colors={chatColors}>
      <Screen padded={false}>
        <View style={[styles.flex, { backgroundColor: chatColors.background }]}>
          <ContactInfoBody conversationId={conversationId} />
        </View>
      </Screen>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth },
  linkTextWrap: { flex: 1 },
});
