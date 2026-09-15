import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { IconButton } from '../../components/IconButton';
import { touchTarget } from '../../theme/spacing';
import type { Message } from '../../api/types';
import { ReplyQuote } from './ReplyQuote';

export function ReplyPreviewBar({ target, onCancel }: { target: Message; onCancel: () => void }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.surface, borderTopColor: colors.border, padding: spacing.sm },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[typography.label, { color: colors.primary, marginBottom: 2 }]}>Replying to</Text>
        {/* The same quote the sent bubble will carry, so what is being
            answered looks identical before and after Send — and a reply
            to a photo shows the photo rather than the word "[image]". */}
        <ReplyQuote target={target} tint={colors.primary} textColor={colors.textSecondary} />
      </View>
      <IconButton
        name="close"
        size={18}
        color={colors.textSecondary}
        touchSize={touchTarget.compact}
        onPress={onCancel}
        accessibilityLabel="Cancel reply"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
});
