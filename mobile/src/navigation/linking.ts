import * as Linking from 'expo-linking';
import type { LinkingOptions } from '@react-navigation/native';

/**
 * voxo://conversation/{conversationId} (spec §31) plus the Expo dev-client
 * prefix so the same link works while developing. Only routes that exist
 * in the currently-mounted navigator (Auth vs Main — see RootNavigator)
 * resolve; the other silently no-ops rather than crashing, since React
 * Navigation only requires the tree that's actually mounted.
 */
export const linking: LinkingOptions<ReactNavigation.RootParamList> = {
  prefixes: [Linking.createURL('/'), 'voxo://'],
  config: {
    screens: {
      Login: 'login',
      ChatsTab: {
        screens: {
          ChatsList: 'chats',
          ConversationDetail: 'conversation/:conversationId',
          // Matches SmsAutoReplyReceiver.kt's own voxo://sms-thread/<phone>
          // notification — the native half has no way to read this file,
          // so the path has to be kept in step by hand.
          SmsThread: 'sms-thread/:phone',
        },
      },
      DashboardTab: 'dashboard',
      CallsTab: 'calls',
      SettingsTab: 'settings',
    },
  },
};
