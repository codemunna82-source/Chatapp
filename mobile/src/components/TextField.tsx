import React, { forwardRef } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string;
}

/** Controlled input designed to be wired via react-hook-form's <Controller render={...}>. */
export const TextField = forwardRef<TextInput, TextFieldProps>(({ label, error, style, ...inputProps }, ref) => {
  const { colors, spacing, radius, typography } = useTheme();

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textTertiary}
        style={[
          typography.body,
          styles.input,
          {
            color: colors.textPrimary,
            backgroundColor: colors.surfaceAlt,
            borderColor: error ? colors.danger : 'transparent',
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm + 4,
          },
          style,
        ]}
        {...inputProps}
      />
      {error ? (
        <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.xs }]}>{error}</Text>
      ) : null}
    </View>
  );
});
TextField.displayName = 'TextField';

const styles = StyleSheet.create({
  input: { borderWidth: 1.5, minHeight: 48 },
});
