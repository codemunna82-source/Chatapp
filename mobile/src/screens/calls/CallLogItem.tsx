import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../../components/Avatar';
import { useTheme } from '../../theme/ThemeProvider';
import { usePlaceCall } from '../../queries/useCalls';
import { getApiErrorMessage } from '../../api/client';
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
  // Contacts (WhatsApp customers) don't have a profile photo in this app —
  // only team members do (Settings/Team avatar upload) — so this always
  // renders initials, same as before this redesign.
  const label = call.contact?.name || call.contact?.phone || 'Unknown contact';
  const isOutbound = call.direction === 'OUTBOUND';
  const isMissedOrFailed = call.status === 'MISSED' || call.status === 'FAILED';
  const tone = isMissedOrFailed ? colors.danger : colors.success;

  const { placeCall, isPending, apiError, linkError } = usePlaceCall();
  const [redialError, setRedialError] = useState<string | null>(null);

  const handleRedial = async () => {
    setRedialError(null);
    const opened = await placeCall(call.contactId);
    if (!opened) {
      setRedialError((apiError && getApiErrorMessage(apiError, 'Could not start that call.')) || linkError || 'Could not start that call.');
    }
  };

  return (
    <View style={[styles.row, { padding: spacing.md }]}>
      <Avatar label={label} size={44} />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text style={[typography.bodyMedium, { color: isMissedOrFailed ? colors.danger : colors.textPrimary }]} numberOfLines={1}>
          {label}
        </Text>
        <View style={styles.subRow}>
          <Ionicons
            name="arrow-up-outline"
            size={13}
            color={tone}
            style={{ marginRight: 4, transform: [{ rotate: isOutbound ? '45deg' : '-135deg' }] }}
          />
          <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>
            {STATUS_LABEL[call.status]} · {formatChatListTime(call.createdAt)}
          </Text>
        </View>
        {redialError ? <Text style={[typography.caption, { color: colors.danger, marginTop: 2 }]}>{redialError}</Text> : null}
      </View>
      <Pressable
        onPress={handleRedial}
        disabled={isPending}
        hitSlop={10}
        style={[styles.callButton, { backgroundColor: colors.primaryMuted }]}
        accessibilityLabel={`Call ${label}`}
      >
        {isPending ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <Ionicons name="call" size={17} color={colors.primary} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  subRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  callButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
