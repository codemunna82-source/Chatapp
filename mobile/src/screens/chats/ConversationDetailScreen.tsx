import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { Screen } from '../../components/Screen';
import { useTheme } from '../../theme/ThemeProvider';
import type { ChatsStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ChatsStackParamList, 'ConversationDetail'>;

/**
 * Placeholder — proves the navigation shell and deep link
 * (voxo://conversation/{conversationId}) both resolve to this screen with
 * the right param. The real chat UI (FlashList messages, composer, etc.)
 * is Phase 7; note that reaching this screen is not itself authorization —
 * the eventual GET /api/conversations/:id call still enforces tenant
 * ownership server-side regardless of how the app navigated here.
 */
export function ConversationDetailScreen({ route }: Props) {
  const { colors, spacing, typography } = useTheme();
  return (
    <Screen>
      <Text style={[typography.heading, { color: colors.textPrimary, marginBottom: spacing.xs }]}>
        Conversation {route.params.conversationId}
      </Text>
      <Text style={[typography.body, { color: colors.textSecondary }]}>Message UI arrives in Phase 7.</Text>
    </Screen>
  );
}
