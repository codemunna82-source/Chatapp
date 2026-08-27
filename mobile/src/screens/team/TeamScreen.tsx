import React, { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { EmptyState } from '../../components/EmptyState';
import { TeamMemberItem } from './TeamMemberItem';
import { TeamMemberFormSheet } from './TeamMemberFormSheet';
import { useTeamMembers, flattenTeamMembers } from '../../queries/useTeam';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import type { TeamMember } from '../../api/types';

export function TeamScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const query = useTeamMembers();
  const members = flattenTeamMembers(query.data);
  const showEmpty = !query.isLoading && members.length === 0;

  const openInvite = () => {
    setEditingMember(null);
    setSheetOpen(true);
  };
  const openEdit = (member: TeamMember) => {
    setEditingMember(member);
    setSheetOpen(true);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.headerRow, { padding: spacing.md }]}>
        <Text style={[typography.heading, { color: colors.textPrimary, flex: 1 }]}>Team</Text>
        <Pressable onPress={openInvite} style={styles.addTouch} accessibilityRole="button" accessibilityLabel="Invite a team member">
          {({ pressed }) => (
            <View
              style={[
                styles.addButton,
                { backgroundColor: colors.primary, borderRadius: radius.full, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons name="person-add" size={18} color={colors.textOnPrimary} />
            </View>
          )}
        </Pressable>
      </View>

      {showEmpty ? (
        <EmptyState
          icon="people-outline"
          title="No team members yet"
          subtitle="Invite a colleague to give them their own login and permissions."
          actionLabel="Invite a member"
          onAction={openInvite}
        />
      ) : (
        <FlashList
          data={members}
          keyExtractor={(item: TeamMember) => item.id}
          renderItem={({ item }: { item: TeamMember }) => <TeamMemberItem member={item} onPress={() => openEdit(item)} />}
          refreshControl={
            <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.primary} />
          }
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) {
              query.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ paddingBottom: spacing.lg }}
        />
      )}

      <TeamMemberFormSheet visible={sheetOpen} member={editingMember} onClose={() => setSheetOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  addTouch: { width: touchTarget.min, height: touchTarget.min, alignItems: 'center', justifyContent: 'center' },
  addButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
