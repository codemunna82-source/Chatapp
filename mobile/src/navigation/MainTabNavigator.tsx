import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import type { MainTabParamList } from './types';
import { ChatsStackNavigator } from './ChatsStackNavigator';
import { SettingsStackNavigator } from './SettingsStackNavigator';
import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { CallsScreen } from '../screens/calls/CallsScreen';
import { useTheme } from '../theme/ThemeProvider';

const Tab = createBottomTabNavigator<MainTabParamList>();

type IoniconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<keyof MainTabParamList, IoniconName> = {
  ChatsTab: 'chatbubble-ellipses',
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
      <Tab.Screen name="DashboardTab" component={DashboardScreen} options={{ title: 'Dashboard' }} />
      <Tab.Screen name="CallsTab" component={CallsScreen} options={{ title: 'Calls' }} />
      <Tab.Screen name="SettingsTab" component={SettingsStackNavigator} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}
