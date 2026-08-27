import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import type { MainTabParamList } from './types';
import { ChatsStackNavigator } from './ChatsStackNavigator';
import { PlaceholderScreen } from '../components/PlaceholderScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { useTheme } from '../theme/ThemeProvider';

const Tab = createBottomTabNavigator<MainTabParamList>();

type IoniconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<keyof MainTabParamList, IoniconName> = {
  ChatsTab: 'chatbubble-ellipses',
  ContactsTab: 'people',
  DashboardTab: 'stats-chart',
  CallsTab: 'call',
  SettingsTab: 'settings',
};

export function MainTabNavigator() {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={TAB_ICONS[route.name as keyof MainTabParamList]} color={color} size={size} />
        ),
      })}
    >
      <Tab.Screen name="ChatsTab" component={ChatsStackNavigator} options={{ title: 'Chats' }} />
      <Tab.Screen name="ContactsTab" options={{ title: 'Contacts' }}>
        {() => <PlaceholderScreen title="Contacts" note="Contact management arrives in Phase 7." />}
      </Tab.Screen>
      <Tab.Screen name="DashboardTab" options={{ title: 'Dashboard' }}>
        {() => <PlaceholderScreen title="Dashboard" note="Analytics arrive in Phase 8." />}
      </Tab.Screen>
      <Tab.Screen name="CallsTab" options={{ title: 'Calls' }}>
        {() => (
          <PlaceholderScreen
            title="Calls"
            note="Calling ships only if Meta's Business Calling API is confirmed available for your account — see ARCHITECTURE.md §6."
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="SettingsTab" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}
