import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from './types';
import { ChatsListScreen } from '../screens/chats/ChatsListScreen';
import { ConversationDetailScreen } from '../screens/chats/ConversationDetailScreen';
import { useTheme } from '../theme/ThemeProvider';

const Stack = createNativeStackNavigator<ChatsStackParamList>();

export function ChatsStackNavigator() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        // The chat list keeps re-rendering behind an open conversation
        // otherwise — it is subscribed to the same conversation cache the
        // open chat is patching, so every message repainted a list that
        // was completely covered.
        freezeOnBlur: true,
      }}
    >
      <Stack.Screen name="ChatsList" component={ChatsListScreen} options={{ title: 'Chats' }} />
      <Stack.Screen
        name="ConversationDetail"
        component={ConversationDetailScreen}
        options={{ title: 'Conversation' }}
      />
    </Stack.Navigator>
  );
}
