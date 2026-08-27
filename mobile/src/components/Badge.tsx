import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function Badge({ count }: { count: number }) {
  const { colors, radius } = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.base, { backgroundColor: colors.primary, borderRadius: radius.full }]}>
      <Text style={[styles.text, { color: colors.textOnPrimary }]}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 12, fontWeight: '700' },
});
