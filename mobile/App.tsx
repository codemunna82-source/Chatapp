import React from 'react';
import { useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './src/queries/queryClient';
import { ThemeProvider } from './src/theme/ThemeProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { Sentry, isSentryEnabled } from './src/lib/sentry';

// Kept visible until auth hydration resolves (see RootNavigator) so the
// app never flashes an empty screen while reading tokens from secure storage.
void SplashScreen.preventAutoHideAsync();

function App() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    // Outside every provider on purpose: a crash inside the theme, query or
    // navigation layer still lands on a usable recovery screen rather than
    // the white void a release build shows.
    <ErrorBoundary scheme={scheme}>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <RootNavigator />
            <StatusBar style="auto" />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

// Sentry.wrap adds the native crash handler and touch breadcrumbs around
// the whole tree. Applied conditionally so a build with no DSN exports the
// plain component and pulls none of the wrapper's behaviour in.
export default isSentryEnabled() ? Sentry.wrap(App) : App;
