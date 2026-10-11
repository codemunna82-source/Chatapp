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
  // Pushed from the chat header's name/subtitle, like the messenger's own
  // contact screen. conversationId rather than contactId: the block/report
  // note and the window-aware caption it shows are reached by an agent
  // already inside a specific thread.
  ContactInfo: { conversationId: string };
  // A lead SMS thread — see useLocalSmsThreads.ts. Not a real conversation:
  // everything it shows comes from the device's own SMS inbox, grouped by
  // sender, never a backend conversationId.
  SmsThread: { phone: string };
};

export type SettingsStackParamList = {
  SettingsHome: undefined;
  Notifications: undefined;
  Wallet: undefined;
  BusinessProfile: undefined;
  WhatsAppNumbers: undefined;
  ConnectWhatsApp: undefined;
  ManageContacts: undefined;
  SmsInbox: undefined;
  Permissions: undefined;
};

export type MainTabParamList = {
  ChatsTab: NavigatorScreenParams<ChatsStackParamList>;
  DashboardTab: undefined;
  CallsTab: undefined;
  SettingsTab: NavigatorScreenParams<SettingsStackParamList>;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends MainTabParamList, AuthStackParamList {}
  }
}
