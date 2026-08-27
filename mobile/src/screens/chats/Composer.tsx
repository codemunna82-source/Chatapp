import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useTheme } from '../../theme/ThemeProvider';
import { emitTypingStart, emitTypingStop } from '../../sockets/actions';
import { useUploadMedia } from '../../queries/useUploadMedia';
import { useSendMessage } from '../../queries/useMessages';
import { getApiErrorMessage } from '../../api/client';
import { formatDuration } from '../../utils/formatTime';

interface ComposerProps {
  conversationId: string;
  whatsappPhoneNumberId: string | undefined;
  withinWindow: boolean;
  onSendText: (text: string) => void;
  onAttach: () => void;
  onUseTemplate: () => void;
  sending: boolean;
  replyToMessageId: string | undefined;
  onVoiceSent: () => void;
}

const TYPING_STOP_DELAY_MS = 2500;
const RECORDER_POLL_MS = 100;
// The relative emphasis of each waveform bar, center-peaked — turns a single
// live metering reading into a small "voice memo" silhouette instead of five
// bars bouncing in lockstep.
const BAR_FACTORS = [0.45, 0.75, 1, 0.75, 0.45];
// expo-audio reports metering in dBFS — roughly -60 (near silence) up to 0
// (peak). There's no fixed noise floor across devices, so this is a
// reasonable approximation for turning it into a 0..1 bar height, not a
// calibrated measurement.
const METERING_FLOOR_DB = -60;

function normalizeMetering(db: number | undefined): number {
  if (db === undefined || Number.isNaN(db)) return 0.12;
  const clamped = Math.max(METERING_FLOOR_DB, Math.min(0, db));
  return (clamped - METERING_FLOOR_DB) / -METERING_FLOOR_DB;
}

function WaveformBar({ level, color }: { level: number; color: string }) {
  const height = useSharedValue(4);

  useEffect(() => {
    // Mutating .value inside useEffect is Reanimated's documented pattern —
    // eslint-plugin-react-hooks' immutability check accepts it here (unlike
    // the same mutation inside a plain event handler elsewhere in this file).
    height.value = withTiming(4 + level * 22, { duration: RECORDER_POLL_MS });
  }, [level, height]);

  const style = useAnimatedStyle(() => ({ height: height.value }));
  return <Animated.View style={[styles.waveformBar, style, { backgroundColor: color }]} />;
}

export function Composer({
  conversationId,
  whatsappPhoneNumberId,
  withinWindow,
  onSendText,
  onAttach,
  onUseTemplate,
  sending,
  replyToMessageId,
  onVoiceSent,
}: ComposerProps) {
  const { colors, spacing, radius, shadow, typography } = useTheme();
  const [text, setText] = useState('');
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canSend = Boolean(text.trim()) && !sending;

  const sendScale = useSharedValue(0.8);
  const sendOpacity = useSharedValue(0);
  const micScale = useSharedValue(1);
  const micOpacity = useSharedValue(1);

  const sendAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sendScale.value }],
    opacity: sendOpacity.value,
  }));
  const micAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: micScale.value }],
    opacity: micOpacity.value,
  }));

  // Mutating .value is Reanimated's documented, intentional API for driving
  // a UI-thread animation from an event handler — not a real React state
  // mutation. eslint-plugin-react-hooks' immutability check doesn't yet
  // recognize this pattern outside useEffect, hence the disables below.
  const setSendButtonVisible = (visible: boolean) => {
    /* eslint-disable react-hooks/immutability */
    sendScale.value = withTiming(visible ? 1 : 0.8, { duration: 140 });
    sendOpacity.value = withTiming(visible ? 1 : 0, { duration: 140 });
    micScale.value = withTiming(visible ? 0.8 : 1, { duration: 140 });
    micOpacity.value = withTiming(visible ? 0 : 1, { duration: 140 });
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

  // --- Voice messages: real mic capture via expo-audio, uploaded and sent
  // through the same media pipeline AttachmentSheet uses (POST
  // /media/upload → POST .../messages with the returned mediaId). ---------
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, RECORDER_POLL_MS);
  const recordingRef = useRef(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const uploadMedia = useUploadMedia();
  const sendMessage = useSendMessage(conversationId);

  useEffect(() => {
    recordingRef.current = recorderState.isRecording;
  }, [recorderState.isRecording]);

  useEffect(
    () => () => {
      // Safety net if the screen unmounts mid-recording (e.g. back
      // navigation) — don't leave the mic session dangling.
      if (recordingRef.current) recorder.stop().catch(() => undefined);
    },
    [recorder],
  );

  const cleanupFile = async (uri: string) => {
    try {
      await new File(uri).delete();
    } catch {
      // Best-effort cache cleanup — a leftover temp file isn't worth surfacing.
    }
  };

  const startRecording = async () => {
    setVoiceError(null);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setVoiceError('Microphone permission was denied — enable it in Android Settings to send voice messages.');
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      setVoiceError('Could not start recording.');
    }
  };

  const discardRecording = async () => {
    const uri = recorder.uri;
    await recorder.stop();
    if (uri) await cleanupFile(uri);
  };

  const sendRecording = async () => {
    if (!whatsappPhoneNumberId) {
      setVoiceError('This conversation has no connected WhatsApp number yet.');
      await discardRecording();
      return;
    }
    // Set busy before stop() resolves so the recording bar stays mounted
    // continuously — otherwise there's a frame where isRecording has
    // flipped false but voiceBusy hasn't flipped true yet, and the
    // composer would flash back to its idle state mid-send.
    setVoiceBusy(true);
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) {
      setVoiceBusy(false);
      return;
    }
    try {
      const uploaded = await uploadMedia.mutateAsync({
        whatsappPhoneNumberId,
        file: { uri, name: `voice-${Date.now()}.m4a`, mimeType: 'audio/mp4' },
      });
      sendMessage.mutate({ type: 'audio', mediaId: uploaded.id, replyToMessageId });
      onVoiceSent();
    } catch (err) {
      setVoiceError(getApiErrorMessage(err, 'Could not send that voice message.'));
    } finally {
      setVoiceBusy(false);
      await cleanupFile(uri);
    }
  };

  // Spec §18: outside the 24h window, only an approved template may be
  // sent — enforced server-side regardless, but the composer shouldn't
  // invite a free-form send (text or voice) that's guaranteed to be rejected.
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

  if (recorderState.isRecording || voiceBusy) {
    return (
      <View
        style={[
          styles.row,
          shadow.sm,
          { backgroundColor: colors.surfaceElevated, borderTopColor: colors.divider, padding: spacing.sm },
        ]}
      >
        {voiceError ? (
          <Text style={[typography.caption, { color: colors.danger }]}>{voiceError}</Text>
        ) : (
          <>
            <Pressable
              onPress={discardRecording}
              disabled={voiceBusy}
              hitSlop={8}
              style={[styles.attachButton, { opacity: voiceBusy ? 0.4 : 1 }]}
              accessibilityLabel="Discard recording"
            >
              <Ionicons name="trash-outline" size={22} color={colors.danger} />
            </Pressable>

            <View style={[styles.recordingRow, { marginHorizontal: spacing.sm }]}>
              <View style={[styles.recordingDot, { backgroundColor: colors.danger, opacity: voiceBusy ? 0.4 : 1 }]} />
              <Text style={[typography.bodyMedium, { color: colors.textPrimary, marginRight: spacing.sm }]}>
                {voiceBusy ? 'Sending…' : formatDuration(recorderState.durationMillis / 1000)}
              </Text>
              {voiceBusy ? null : (
                <View style={styles.waveform}>
                  {BAR_FACTORS.map((factor, i) => (
                    <WaveformBar
                      key={i}
                      level={normalizeMetering(recorderState.metering) * factor}
                      color={colors.primary}
                    />
                  ))}
                </View>
              )}
            </View>

            <Pressable
              onPress={sendRecording}
              disabled={voiceBusy}
              hitSlop={8}
              style={[styles.sendButton, { backgroundColor: colors.primary, borderRadius: radius.full, opacity: voiceBusy ? 0.6 : 1 }]}
              accessibilityLabel="Send voice message"
            >
              <Ionicons name="checkmark" size={19} color={colors.textOnPrimary} />
            </Pressable>
          </>
        )}
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
      {voiceError ? (
        <Text style={[typography.caption, { color: colors.danger, marginRight: spacing.xs }]} numberOfLines={2}>
          {voiceError}
        </Text>
      ) : null}
      <View style={styles.actionSlot}>
        <Animated.View style={[styles.actionSlotLayer, micAnimatedStyle]} pointerEvents={canSend ? 'none' : 'auto'}>
          <Pressable
            onPress={startRecording}
            hitSlop={8}
            style={[styles.sendButton, { backgroundColor: colors.primary, borderRadius: radius.full }]}
            accessibilityLabel="Record a voice message"
          >
            <Ionicons name="mic" size={18} color={colors.textOnPrimary} />
          </Pressable>
        </Animated.View>
        <Animated.View style={[styles.actionSlotLayer, sendAnimatedStyle]} pointerEvents={canSend ? 'auto' : 'none'}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', borderTopWidth: StyleSheet.hairlineWidth },
  attachButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  input: { flex: 1, maxHeight: 120, paddingVertical: 9, marginHorizontal: 4 },
  actionSlot: { width: 34, height: 34, marginLeft: 2 },
  actionSlotLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  sendButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  blockedBar: { borderTopWidth: StyleSheet.hairlineWidth },
  templateButton: { alignItems: 'center' },
  recordingRow: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  recordingDot: { width: 9, height: 9, borderRadius: 5, marginRight: 8 },
  waveform: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  waveformBar: { width: 3, borderRadius: 2, marginHorizontal: 2 },
});
