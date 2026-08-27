import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import type { MessageStatus } from '../../api/types';

/** Only shown on OUT messages — spec §19's "message status" indicator. */
export function MessageStatusIcon({ status }: { status: MessageStatus }) {
  const { colors } = useTheme();

  if (status === 'QUEUED') return <Ionicons name="time-outline" size={14} color={colors.textSecondary} />;
  if (status === 'FAILED') return <Ionicons name="alert-circle" size={14} color={colors.danger} />;
  if (status === 'SENT') return <Ionicons name="checkmark" size={14} color={colors.textSecondary} />;
  if (status === 'DELIVERED') return <Ionicons name="checkmark-done" size={14} color={colors.textSecondary} />;
  // READ
  return <Ionicons name="checkmark-done" size={14} color={colors.primary} />;
}
