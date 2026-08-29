import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import type { MessageStatus } from '../../api/types';

/**
 * Only shown on OUT messages — spec §19's "message status" indicator.
 *
 * `size` is a prop because the chat LIST reuses this at a smaller scale:
 * the tick beside a row's preview text should read as part of that line,
 * not as a second icon competing with it.
 */
export function MessageStatusIcon({ status, size = 14 }: { status: MessageStatus; size?: number }) {
  const { colors } = useTheme();

  if (status === 'QUEUED') return <Ionicons name="time-outline" size={size} color={colors.textSecondary} />;
  if (status === 'FAILED') return <Ionicons name="alert-circle" size={size} color={colors.danger} />;
  if (status === 'SENT') return <Ionicons name="checkmark" size={size} color={colors.textSecondary} />;
  if (status === 'DELIVERED') return <Ionicons name="checkmark-done" size={size} color={colors.textSecondary} />;
  // READ
  return <Ionicons name="checkmark-done" size={size} color={colors.primary} />;
}
