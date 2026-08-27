import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
};

export type ChatsStackParamList = {
  ChatsList: undefined;
  // Deep-linked target for voxo://conversation/{conversationId} (spec §31)
  // and for a tapped push notification (spec §30) — real content in Phase 7,
  // authorization is still enforced server-side by whichever API call that
  // screen ends up making, never assumed from the fact the link was opened.
  ConversationDetail: { conversationId: string };
};

export type MainTabParamList = {
  ChatsTab: NavigatorScreenParams<ChatsStackParamList>;
  ContactsTab: undefined;
  DashboardTab: undefined;
  CallsTab: undefined;
  SettingsTab: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends MainTabParamList, AuthStackParamList {}
  }
}
