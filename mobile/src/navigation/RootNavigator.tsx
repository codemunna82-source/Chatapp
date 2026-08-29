import React, { useEffect } from 'react';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import { linking } from './linking';
import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useAuthStore } from '../store/authStore';
import { RealtimeSync } from '../sockets/RealtimeSync';
import { PushNotificationSync } from '../notifications/PushNotificationSync';

export function RootNavigator() {
  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);
  // A ref rather than the useNavigation hook: PushNotificationSync sits
  // beside the navigator, not inside it, so there is no navigation context
  // for it to read.
  const navigationRef = useNavigationContainerRef();

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
    <NavigationContainer ref={navigationRef} linking={linking} fallback={<LoadingIndicator fullscreen />}>
      {status === 'signedIn' ? (
        <>
          <RealtimeSync />
          <PushNotificationSync navigationRef={navigationRef} />
          <MainTabNavigator />
        </>
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
}
