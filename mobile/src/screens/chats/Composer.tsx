import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { emitTypingStart, emitTypingStop } from '../../sockets/actions';

interface ComposerProps {
  conversationId: string;
  withinWindow: boolean;
  onSendText: (text: string) => void;
  onAttach: () => void;
  onUseTemplate: () => void;
  sending: boolean;
}

const TYPING_STOP_DELAY_MS = 2500;

export function Composer({ conversationId, withinWindow, onSendText, onAttach, onUseTemplate, sending }: ComposerProps) {
  const { colors, spacing, radius, typography } = useTheme();
  const [text, setText] = useState('');
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChangeText = (value: string) => {
    setText(value);
    emitTypingStart(conversationId);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => emitTypingStop(conversationId), TYPING_STOP_DELAY_MS);
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    onSendText(trimmed);
    setText('');
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    emitTypingStop(conversationId);
  };

  // Spec §18: outside the 24h window, only an approved template may be
  // sent — enforced server-side regardless, but the composer shouldn't
  // invite a free-form send that's guaranteed to be rejected.
  if (!withinWindow) {
    return (
      <View style={[styles.blockedBar, { backgroundColor: colors.surface, borderTopColor: colors.border, padding: spacing.md }]}>
        <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
          It&apos;s been over 24 hours since this contact last messaged you — send an approved template to continue.
        </Text>
        <Pressable
          onPress={onUseTemplate}
          style={[styles.templateButton, { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.sm }]}
        >
          <Text style={[typography.bodyMedium, { color: colors.textOnPrimary, textAlign: 'center' }]}>Use a template</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderTopColor: colors.border, padding: spacing.sm }]}>
      <Pressable onPress={onAttach} hitSlop={8} style={{ marginRight: spacing.xs }}>
        <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
      </Pressable>
      <TextInput
        value={text}
        onChangeText={handleChangeText}
        placeholder="Message"
        placeholderTextColor={colors.textSecondary}
        multiline
        style={[
          styles.input,
          typography.body,
          { color: colors.textPrimary, backgroundColor: colors.background, borderRadius: radius.lg, paddingHorizontal: spacing.sm },
        ]}
      />
      <Pressable onPress={handleSend} disabled={!text.trim() || sending} hitSlop={8} style={{ marginLeft: spacing.xs }}>
        <Ionicons
          name="send"
          size={22}
          color={text.trim() && !sending ? colors.primary : colors.textSecondary}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, maxHeight: 120, paddingVertical: 8 },
  blockedBar: { borderTopWidth: StyleSheet.hairlineWidth },
  templateButton: { alignItems: 'center' },
});
