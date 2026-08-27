import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../../components/Avatar';
import { useTheme } from '../../theme/ThemeProvider';
import { formatChatListTime } from '../../utils/formatTime';
import type { CallLog } from '../../api/types';

const STATUS_LABEL: Record<CallLog['status'], string> = {
  INITIATED: 'Handed off to WhatsApp',
  RINGING: 'Ringing',
  ANSWERED: 'Answered',
  COMPLETED: 'Completed',
  MISSED: 'Missed',
  FAILED: 'Failed',
};

export function CallLogItem({ call }: { call: CallLog }) {
  const { colors, spacing, typography } = useTheme();
  const label = call.contact?.name || call.contact?.phone || 'Unknown contact';
  const isOutbound = call.direction === 'OUTBOUND';
  const isMissedOrFailed = call.status === 'MISSED' || call.status === 'FAILED';

  return (
    <View style={[styles.row, { padding: spacing.md }]}>
      <Avatar label={label} />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={1}>
          {label}
        </Text>
        <View style={styles.subRow}>
          <Ionicons
            name={isOutbound ? 'call-outline' : 'call-outline'}
            size={13}
            color={isMissedOrFailed ? colors.danger : colors.textSecondary}
            style={{ marginRight: 4, transform: [{ rotate: isOutbound ? '90deg' : '-90deg' }] }}
          />
          <Text style={[typography.caption, { color: isMissedOrFailed ? colors.danger : colors.textSecondary }]}>
            {STATUS_LABEL[call.status]}
          </Text>
        </View>
      </View>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{formatChatListTime(call.createdAt)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  subRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
});
