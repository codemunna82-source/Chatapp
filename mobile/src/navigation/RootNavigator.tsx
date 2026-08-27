import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import { linking } from './linking';
import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useAuthStore } from '../store/authStore';

export function RootNavigator() {
  const status = useAuthStore((s) => s.status);
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
      {status === 'signedIn' ? <MainTabNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
