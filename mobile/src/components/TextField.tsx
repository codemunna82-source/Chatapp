import React, { forwardRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string;
  /** Rendered inside the field on the right — a password reveal toggle, a unit, a clear button. */
  rightAccessory?: ReactNode;
}

/**
 * Controlled input designed to be wired via react-hook-form's
 * <Controller render={...}>.
 *
 * The border carries three states rather than two: transparent at rest,
 * the accent colour while focused, danger on an error. Focus was
 * previously invisible except for the caret, which on a form of similarly
 * styled fields left no indication of where typing would land.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(
  ({ label, error, style, rightAccessory, onFocus, onBlur, ...inputProps }, ref) => {
    const { colors, spacing, radius, typography } = useTheme();
    const [focused, setFocused] = useState(false);

    const borderColor = error ? colors.danger : focused ? colors.primary : 'transparent';

    return (
      <View style={{ marginBottom: spacing.md }}>
        <Text
          style={[
            typography.label,
            { color: focused && !error ? colors.primary : colors.textSecondary, marginBottom: spacing.xs },
          ]}
        >
          {label}
        </Text>
        <View
          style={[
            styles.field,
            {
              backgroundColor: colors.surfaceAlt,
              borderColor,
              borderRadius: radius.md,
              paddingRight: rightAccessory ? spacing.xs : 0,
            },
          ]}
        >
          <TextInput
            ref={ref}
            placeholderTextColor={colors.textTertiary}
            // The caller's own handlers still run — this only adds the
            // focus tracking on top, so react-hook-form's onBlur (which is
            // what triggers validation) is never swallowed.
            onFocus={(e) => {
              setFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              onBlur?.(e);
            }}
            style={[
              typography.body,
              styles.input,
              {
                color: colors.textPrimary,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm + 4,
              },
              style,
            ]}
            {...inputProps}
          />
          {rightAccessory}
        </View>
        {error ? (
          <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.xs }]}>{error}</Text>
        ) : null}
      </View>
    );
  },
);
TextField.displayName = 'TextField';

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, minHeight: 48 },
  input: { flex: 1 },
});
