import React from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { queryClient } from './src/queries/queryClient';
import { ThemeProvider } from './src/theme/ThemeProvider';
import { RootNavigator } from './src/navigation/RootNavigator';

// Kept visible until auth hydration resolves (see RootNavigator) so the
// app never flashes an empty screen while reading tokens from secure storage.
void SplashScreen.preventAutoHideAsync();

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            {/* One shared modal host for every bottom sheet (attachments,
                emoji picker) — @gorhom/bottom-sheet is pure JS on top of
                gesture-handler + reanimated, both already dependencies, so
                this adds real swipe-to-dismiss/rounded-sheet behavior with
                no new native module. */}
            <BottomSheetModalProvider>
              <RootNavigator />
              <StatusBar style="auto" />
            </BottomSheetModalProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
