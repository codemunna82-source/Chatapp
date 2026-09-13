import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueries } from '@tanstack/react-query';
import { Avatar } from '../../components/Avatar';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import { useGuestPresenceStore } from '../../store/guestPresenceStore';
import { queryKeys } from '../../queries/keys';
import * as conversationsApi from '../../api/endpoints/conversations';

interface LiveNowSheetProps {
  visible: boolean;
  onClose: () => void;
  onOpenConversation: (conversationId: string) => void;
}

/**
 * Who is sitting in their private chat window right now.
 *
 * These are the only customers a message reaches while they are looking
 * at it, and the only ones who can actually pick up a call — the call
 * button places one regardless, but without the window open there is no
 * device at the other end to ring. So this is a short list of the people
 * worth answering FIRST, which is not something the inbox's own ordering
 * can tell you: a chat that has been quiet for an hour sits below a
 * newer one whose customer has already walked away.
 */
export function LiveNowSheet({ visible, onClose, onOpenConversation }: LiveNowSheetProps) {
  const { colors, spacing, radius, typography } = useTheme();
  const open = useGuestPresenceStore((s) => s.open);
  const ids = useMemo(() => Object.keys(open), [open]);

  /**
   * Presence arrives for the whole workspace over the socket, not just
   * for the chats this screen happens to have loaded — so an id here can
   * belong to a conversation the list has never paged in. Each one is
   * fetched by id, which React Query serves from cache whenever it
   * already has it, and there are only ever a handful of these.
   */
  const conversations = useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.conversation(id),
      queryFn: () => conversationsApi.getConversation(id),
      enabled: visible,
    })),
  });

  const rows = conversations.map((q, i) => ({ id: ids[i]!, data: q.data }));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.scrim, { backgroundColor: colors.overlay }]} onPress={onClose} />

      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surfaceElevated,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            paddingBottom: spacing.lg,
          },
        ]}
      >
        <View style={[styles.header, { paddingHorizontal: spacing.md, paddingVertical: spacing.sm }]}>
          <View style={styles.headerTitle}>
            <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
            <Text style={[typography.bodyMedium, { color: colors.textPrimary, marginLeft: spacing.xs }]}>
              In the chat window now
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            {({ pressed }) => (
              <Ionicons name="close" size={22} color={colors.textSecondary} style={{ opacity: pressed ? 0.5 : 1 }} />
            )}
          </Pressable>
        </View>

        <Text
          style={[typography.caption, { color: colors.textSecondary, paddingHorizontal: spacing.md, marginBottom: spacing.sm }]}
        >
          A reply lands while they are looking, and a call can be answered.
        </Text>

        <ScrollView style={styles.listScroll} showsVerticalScrollIndicator={false}>
          {rows.length === 0 ? (
            // Reachable: someone can close their tab while this sheet is
            // open, and the list empties under the reader.
            <Text
              style={[
                typography.body,
                { color: colors.textSecondary, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
              ]}
            >
              Nobody has the chat window open right now.
            </Text>
          ) : (
            rows.map(({ id, data }) => {
              const label = data?.contact?.name || data?.contact?.phone || 'Loading…';
              return (
                <Pressable
                  key={id}
                  onPress={() => onOpenConversation(id)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Open chat with ${label}`}
                >
                  <View>
                    <Avatar
                      label={label}
                      contactId={data?.contactId}
                      version={data?.contact?.avatarUpdatedAt}
                      size={42}
                    />
                    <View
                      style={[styles.presenceDot, { backgroundColor: colors.success, borderColor: colors.surfaceElevated }]}
                    />
                  </View>
                  <View style={[styles.rowText, { marginLeft: spacing.md }]}>
                    <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={1}>
                      {label}
                    </Text>
                    <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                      {data?.lastMessagePreview || 'No messages yet'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  sheet: { maxHeight: '58%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { flexDirection: 'row', alignItems: 'center' },
  liveDot: { width: 9, height: 9, borderRadius: 5 },
  listScroll: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget.compact },
  rowText: { flex: 1 },
  presenceDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
  },
});
