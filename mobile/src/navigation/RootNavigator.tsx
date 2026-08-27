import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { linking } from './linking';
import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useAuthStore } from '../store/authStore';
import { useTheme } from '../theme/ThemeProvider';
import { RealtimeSync } from '../sockets/RealtimeSync';

/**
 * Shown for the lifetime of a "Continue without login" testing session (see
 * LoginScreen/authStore.enterDemoMode) so it's never mistaken for a real
 * logged-in state — every screen underneath is still hitting the real API
 * and will show real network errors with no backend reachable.
 */
function DemoModeBanner() {
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={{ backgroundColor: colors.warning, paddingVertical: spacing.xs, paddingHorizontal: spacing.md }}>
      <Text style={[typography.caption, { color: colors.textOnPrimary, textAlign: 'center' }]}>
        Demo mode — not signed in, no backend connected
      </Text>
    </View>
  );
}

export function RootNavigator() {
  const status = useAuthStore((s) => s.status);
  const demoMode = useAuthStore((s) => s.demoMode);
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    // Reveal the app only once we know whether there's a valid session —
    // pairs with SplashScreen.preventAutoHideAsync() in App.tsx.
    if (status !== 'hydrating') {
      void SplashScreen.hideAsync();
    }
  }, [status]);

  if (status === 'hydrating') {
    return <LoadingIndicator fullscreen />;
  }

  return (
    <NavigationContainer linking={linking} fallback={<LoadingIndicator fullscreen />}>
      {status === 'signedIn' ? (
        <>
          {demoMode ? <DemoModeBanner /> : null}
          <RealtimeSync />
          <MainTabNavigator />
        </>
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
}
