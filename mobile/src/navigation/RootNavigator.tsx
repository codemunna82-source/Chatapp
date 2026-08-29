import React, { useEffect } from 'react';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import { linking } from './linking';
import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useAuthStore } from '../store/authStore';
import { RealtimeSync } from '../sockets/RealtimeSync';
import { OutboxFlusher } from '../sockets/OutboxFlusher';
import { PushNotificationSync } from '../notifications/PushNotificationSync';
import { navigationIntegration, isSentryEnabled } from '../lib/sentry';

export function RootNavigator() {
  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);
  // A ref rather than the useNavigation hook: PushNotificationSync sits
  // beside the navigator, not inside it, so there is no navigation context
  // for it to read.
  const navigationRef = useNavigationContainerRef();

  const refreshUser = useAuthStore((s) => s.refreshUser);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Re-reads role and permissions from the server once a session is
  // restored. hydrate() only replays what was cached at the last login, so
  // without this a member promoted to MASTER_ADMIN would keep the old UI —
  // no admin rows, no user management — until they happened to sign out and
  // back in, with nothing on screen to explain why.
  useEffect(() => {
    if (status === 'signedIn') {
      void refreshUser();
    }
  }, [status, refreshUser]);

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
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      fallback={<LoadingIndicator fullscreen />}
      // Tags every event with the screen it happened on. Without it a
      // crash report says which component threw but not what the user was
      // looking at, which is usually the more useful half.
      onReady={() => {
        if (isSentryEnabled()) navigationIntegration.registerNavigationContainer(navigationRef);
      }}
    >
      {status === 'signedIn' ? (
        <>
          <RealtimeSync />
          <OutboxFlusher />
          <PushNotificationSync navigationRef={navigationRef} />
          <MainTabNavigator />
        </>
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
}
