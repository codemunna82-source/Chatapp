import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
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
  const { colors, spacing, radius, shadow, typography } = useTheme();
  const [text, setText] = useState('');
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canSend = Boolean(text.trim()) && !sending;
  const sendScale = useSharedValue(0.8);
  const sendOpacity = useSharedValue(0);

  const sendAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sendScale.value }],
    opacity: sendOpacity.value,
  }));

  // Mutating .value is Reanimated's documented, intentional API for driving
  // a UI-thread animation from an event handler — not a real React state
  // mutation. eslint-plugin-react-hooks' immutability check doesn't yet
  // recognize this pattern outside useEffect, hence the disables below.
  const setSendButtonVisible = (visible: boolean) => {
    /* eslint-disable react-hooks/immutability */
    sendScale.value = withTiming(visible ? 1 : 0.8, { duration: 140 });
    sendOpacity.value = withTiming(visible ? 1 : 0, { duration: 140 });
    /* eslint-enable react-hooks/immutability */
  };

  const handleChangeText = (value: string) => {
    setText(value);
    setSendButtonVisible(Boolean(value.trim()));
    emitTypingStart(conversationId);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => emitTypingStop(conversationId), TYPING_STOP_DELAY_MS);
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    onSendText(trimmed);
    setText('');
    setSendButtonVisible(false);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    emitTypingStop(conversationId);
  };

  // Spec §18: outside the 24h window, only an approved template may be
  // sent — enforced server-side regardless, but the composer shouldn't
  // invite a free-form send that's guaranteed to be rejected.
  if (!withinWindow) {
    return (
      <View
        style={[
          styles.blockedBar,
          { backgroundColor: colors.surfaceElevated, borderTopColor: colors.divider, padding: spacing.md },
        ]}
      >
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
    <View
      style={[
        styles.row,
        shadow.sm,
        { backgroundColor: colors.surfaceElevated, borderTopColor: colors.divider, padding: spacing.sm },
      ]}
    >
      <Pressable onPress={onAttach} hitSlop={8} style={styles.attachButton} accessibilityLabel="Add attachment">
        <Ionicons name="add" size={24} color={colors.textSecondary} />
      </Pressable>
      <TextInput
        value={text}
        onChangeText={handleChangeText}
        placeholder="Message"
        placeholderTextColor={colors.textTertiary}
        multiline
        style={[
          styles.input,
          typography.body,
          { color: colors.textPrimary, backgroundColor: colors.surfaceAlt, borderRadius: radius.xl, paddingHorizontal: spacing.md },
        ]}
      />
      <Animated.View style={sendAnimatedStyle}>
        <Pressable
          onPress={handleSend}
          disabled={!canSend}
          hitSlop={8}
          style={[styles.sendButton, { backgroundColor: colors.primary, borderRadius: radius.full }]}
          accessibilityLabel="Send message"
        >
          <Ionicons name="arrow-up" size={19} color={colors.textOnPrimary} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', borderTopWidth: StyleSheet.hairlineWidth },
  attachButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  input: { flex: 1, maxHeight: 120, paddingVertical: 9, marginHorizontal: 4 },
  sendButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  blockedBar: { borderTopWidth: StyleSheet.hairlineWidth },
  templateButton: { alignItems: 'center' },
});
