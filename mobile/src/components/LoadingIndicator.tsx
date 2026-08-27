import React from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function LoadingIndicator({ fullscreen = false }: { fullscreen?: boolean }) {
  const { colors } = useTheme();
  if (!fullscreen) return <ActivityIndicator color={colors.primary} />;
  return (
    <View style={[styles.fullscreen, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  fullscreen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
