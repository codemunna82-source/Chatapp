import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { IconButton } from './IconButton';
import { touchTarget } from '../theme/spacing';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChangeText, placeholder = 'Search' }: SearchBarProps) {
  const { colors, spacing, radius, shadow } = useTheme();
  return (
    <View
      style={[
        styles.container,
        shadow.sm,
        {
          backgroundColor: colors.surfaceElevated,
          borderRadius: radius.full,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          paddingHorizontal: spacing.md,
          marginHorizontal: spacing.md,
          // Sits clear of the header instead of flush against it, and reads
          // as a raised pill rather than a flat inset field.
          marginTop: spacing.sm,
          marginBottom: spacing.sm,
        },
      ]}
    >
      <Ionicons name="search" size={18} color={colors.textTertiary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        style={[styles.input, { color: colors.textPrimary, marginLeft: spacing.sm }]}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <IconButton
          name="close-circle"
          size={18}
          color={colors.textTertiary}
          touchSize={touchTarget.compact}
          onPress={() => onChangeText('')}
          accessibilityLabel="Clear search"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget.compact },
  input: { flex: 1, fontSize: 15.5 },
});
