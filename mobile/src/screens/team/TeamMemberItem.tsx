import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { useTheme } from '../../theme/ThemeProvider';
import type { TeamMember } from '../../api/types';

function TeamMemberItemImpl({ member, onPress }: { member: TeamMember; onPress: (member: TeamMember) => void }) {
  const handlePress = useCallback(() => onPress(member), [onPress, member]);
  const { colors, spacing, typography } = useTheme();
  const label = member.displayName || member.email;
  const isDisabled = member.status === 'DISABLED';

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.row,
        { padding: spacing.md, backgroundColor: pressed ? colors.surface : colors.background },
      ]}
    >
      <Avatar userId={member.id} version={member.avatarUpdatedAt} label={label} />
      <View style={{ flex: 1, marginLeft: spacing.md, opacity: isDisabled ? 0.5 : 1 }}>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>
          {member.email}
        </Text>
      </View>
      <View
        style={[
          styles.pill,
          { backgroundColor: member.role === 'MASTER_ADMIN' ? colors.primaryMuted : colors.surfaceAlt, marginRight: spacing.xs },
        ]}
      >
        <Text style={[typography.caption, { color: member.role === 'MASTER_ADMIN' ? colors.primary : colors.textSecondary }]}>
          {member.role === 'MASTER_ADMIN' ? 'Admin' : 'Member'}
        </Text>
      </View>
      {isDisabled ? (
        <View style={[styles.pill, { backgroundColor: `${colors.danger}22` }]}>
          <Text style={[typography.caption, { color: colors.danger }]}>Disabled</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Memoized: list rows re-render whenever the screen above them does (search
 * text, a refetch, a sheet opening). The callbacks take their item rather
 * than closing over it so the parent can pass one stable function per list.
 */
export const TeamMemberItem = React.memo(TeamMemberItemImpl);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
});
