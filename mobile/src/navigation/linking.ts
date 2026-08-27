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
        },
      },
      ContactsTab: 'contacts',
      DashboardTab: 'dashboard',
      CallsTab: 'calls',
      SettingsTab: 'settings',
    },
  },
};
