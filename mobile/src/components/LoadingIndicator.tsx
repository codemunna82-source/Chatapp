import React from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { BrandLoader } from './BrandLoader';

/**
 * Fullscreen waits get VOXO's own mark — those are the moments the user is
 * looking at nothing else, and a bare platform spinner there makes the app
 * feel like it belongs to no one. Inline uses keep the stock indicator:
 * inside a button or a list footer, a branded mark is noise.
 */
export function LoadingIndicator({ fullscreen = false, label }: { fullscreen?: boolean; label?: string }) {
  const { colors } = useTheme();
  if (!fullscreen) return <ActivityIndicator color={colors.primary} />;
  return (
    <View style={[styles.fullscreen, { backgroundColor: colors.background }]}>
      <BrandLoader size="lg" label={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  fullscreen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
