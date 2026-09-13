import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { MainTabParamList } from './types';
import { ChatsStackNavigator } from './ChatsStackNavigator';
import { SettingsStackNavigator } from './SettingsStackNavigator';
import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { CallsScreen } from '../screens/calls/CallsScreen';
import { useTheme } from '../theme/ThemeProvider';
import { useTabBadges } from '../queries/useTabBadges';
import { useCallsSeenStore } from '../store/callsSeenStore';

const Tab = createBottomTabNavigator<MainTabParamList>();

type IoniconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<keyof MainTabParamList, IoniconName> = {
  ChatsTab: 'chatbubble-ellipses',
  DashboardTab: 'stats-chart',
  CallsTab: 'call',
  SettingsTab: 'settings',
};

/**
 * Hides the tab bar once the Chats stack is showing a conversation.
 *
 * Read off the nested navigation state rather than set from inside the
 * screen: doing it with navigation.getParent()?.setOptions in an effect
 * runs a frame late, so the bar flickers in and out on every open and
 * close. The route's own state is already correct when the options are
 * evaluated.
 *
 * The undefined case matters: returning undefined means "no override",
 * which keeps the bar's normal styling. Returning {} would silently drop
 * the background and border colours set in screenOptions.
 */
/**
 * Which screen inside the Chats stack is actually on top.
 *
 * getFocusedRouteNameFromRoute rather than reading route.state by hand,
 * which is what this did and why the bar never actually hid: the route
 * object handed to a screen's `options` does not carry the nested
 * navigator's state in React Navigation 7, so the lookup found nothing
 * and quietly returned "show the bar" for every screen, conversation
 * included. This helper is the supported way to ask, and falls back to
 * the stack's initial route before that state exists.
 */
function focusedChatsScreen(route: Parameters<typeof getFocusedRouteNameFromRoute>[0]): string {
  return getFocusedRouteNameFromRoute(route) ?? 'ChatsList';
}

export function MainTabNavigator() {
  const { colors } = useTheme();
  // Named once so the Chats tab can restore it: a screen's own
  // `tabBarStyle` REPLACES the navigator's rather than merging with it,
  // so returning undefined there would drop the bar's colours instead of
  // leaving them alone.
  const tabBarBase = { backgroundColor: colors.surface, borderTopColor: colors.border };
  const { unreadChats, missedCalls } = useTabBadges();
  const markCallsSeen = useCallsSeenStore((s) => s.markSeen);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        // A tab you cannot see stops rendering entirely.
        //
        // Without this, all four tabs stayed live: every cache patch —
        // and RealtimeSync makes one per incoming message — re-rendered
        // the Dashboard's charts and the call log behind whatever the
        // user was actually looking at. On a busy inbox that is a steady
        // drip of work for pixels nobody can see, and it comes out of the
        // same frame budget as the chat they ARE looking at.
        freezeOnBlur: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: tabBarBase,
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={TAB_ICONS[route.name as keyof MainTabParamList]} color={color} size={size} />
        ),
      })}
    >
      {/* The tab bar is hidden inside a conversation.
          It was visible there, which cost the thread a bar's worth of
          height on every screen AND left a dead band above the keyboard:
          the bar hides itself when the IME opens, but the keyboard-inset
          padding below still reserves the keyboard's full height, so the
          two never added up to the bottom of the screen.
          Every messenger does this — a chat is a place you are in, not a
          tab you are on. */}
      <Tab.Screen
        name="ChatsTab"
        component={ChatsStackNavigator}
        options={({ route }) => ({
          title: 'Chats',
          tabBarStyle: focusedChatsScreen(route) === 'ConversationDetail' ? { display: 'none' } : tabBarBase,
          // 99+ rather than a four-digit number: past a point the exact
          // count stops being information and starts being a wide pill
          // that pushes the label out of the tab.
          tabBarBadge: unreadChats > 0 ? (unreadChats > 99 ? '99+' : unreadChats) : undefined,
        })}
      />
      <Tab.Screen name="DashboardTab" component={DashboardScreen} options={{ title: 'Dashboard' }} />
      <Tab.Screen
        name="CallsTab"
        component={CallsScreen}
        options={{
          title: 'Calls',
          tabBarBadge: missedCalls > 0 ? (missedCalls > 99 ? '99+' : missedCalls) : undefined,
        }}
        // Opening the tab is what clears the badge — calls have no read
        // state on the server, so "since I last looked" is the only
        // honest thing to count to.
        listeners={{ tabPress: () => markCallsSeen(), focus: () => markCallsSeen() }}
      />
      <Tab.Screen name="SettingsTab" component={SettingsStackNavigator} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}
