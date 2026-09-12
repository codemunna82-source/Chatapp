import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { SettingsStackParamList } from './types';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { NotificationsScreen } from '../screens/settings/NotificationsScreen';
import { WalletScreen } from '../screens/settings/WalletScreen';
import { WhatsAppNumbersScreen } from '../screens/settings/WhatsAppNumbersScreen';
import { ConnectWhatsAppScreen } from '../screens/settings/ConnectWhatsAppScreen';
import { BusinessProfileScreen } from '../screens/settings/BusinessProfileScreen';
import { ManageContactsScreen } from '../screens/contacts/ManageContactsScreen';
import { useTheme } from '../theme/ThemeProvider';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export function SettingsStackNavigator() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
      }}
    >
      <Stack.Screen name="SettingsHome" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <Stack.Screen name="Wallet" component={WalletScreen} options={{ title: 'Wallet' }} />
      <Stack.Screen name="BusinessProfile" component={BusinessProfileScreen} options={{ title: 'Business profile' }} />
      <Stack.Screen name="WhatsAppNumbers" component={WhatsAppNumbersScreen} options={{ title: 'WhatsApp number' }} />
      <Stack.Screen name="ConnectWhatsApp" component={ConnectWhatsAppScreen} options={{ title: 'Connect WhatsApp' }} />
      <Stack.Screen name="ManageContacts" component={ManageContactsScreen} options={{ title: 'Contacts' }} />
    </Stack.Navigator>
  );
}
