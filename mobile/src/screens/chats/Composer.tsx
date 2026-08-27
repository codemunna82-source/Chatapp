import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
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
import { EmojiPicker } from './EmojiPicker';

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
// Drag distance (px) that commits a cancel/lock while holding the mic —
// matches the familiar WhatsApp-style gesture (spec §10).
const CANCEL_THRESHOLD_X = -90;
const LOCK_THRESHOLD_Y = -70;
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

function RecordingWaveform({ metering, color }: { metering: number | undefined; color: string }) {
  return (
    <View style={styles.waveform}>
      {BAR_FACTORS.map((factor, i) => (
        <WaveformBar key={i} level={normalizeMetering(metering) * factor} color={color} />
      ))}
    </View>
  );
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
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [emojiPickerVisible, setEmojiPickerVisible] = useState(false);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canSend = Boolean(text.trim()) && !sending;

  const sendScale = useSharedValue(0.8);
  const sendOpacity = useSharedValue(0);
  const micScale = useSharedValue(1);
  const micOpacity = useSharedValue(1);
  // Live drag offset while holding the mic (unlocked) — drives both the
  // button's own translate and the cancel/lock hints' visibility.
  const micTranslateX = useSharedValue(0);
  const micTranslateY = useSharedValue(0);
  // Worklet-side lock flag, checked inside the gesture callbacks (which run
  // on the UI thread and can't safely read React state).
  const lockedSV = useSharedValue(0);

  const sendAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sendScale.value }],
    opacity: sendOpacity.value,
  }));
  const micAnimatedStyle = useAnimatedStyle(() => ({
    opacity: micOpacity.value,
    transform: [{ scale: micScale.value }, { translateX: micTranslateX.value }, { translateY: micTranslateY.value }],
  }));
  const lockHintStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(micTranslateY.value) / Math.abs(LOCK_THRESHOLD_Y)),
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

  const handleSelectionChange = (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    setSelection(e.nativeEvent.selection);
  };

  const handleSelectEmoji = (char: string) => {
    const next = `${text.slice(0, selection.start)}${char}${text.slice(selection.end)}`;
    const cursor = selection.start + char.length;
    setSelection({ start: cursor, end: cursor });
    handleChangeText(next);
  };

  // --- Media/camera quick action + voice messages: real mic capture via
  // expo-audio, uploaded and sent through the same media pipeline
  // AttachmentSheet uses (POST /media/upload → POST .../messages). --------
  const uploadMedia = useUploadMedia();
  const sendMessage = useSendMessage(conversationId);

  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const pickFromCameraQuick = async () => {
    setCameraError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setCameraError('Camera permission was denied.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    if (!whatsappPhoneNumberId) {
      setCameraError('This conversation has no connected WhatsApp number yet.');
      return;
    }
    setCameraBusy(true);
    try {
      const uploaded = await uploadMedia.mutateAsync({
        whatsappPhoneNumberId,
        file: { uri: asset.uri, name: asset.fileName ?? 'photo.jpg', mimeType: asset.mimeType ?? 'image/jpeg' },
      });
      sendMessage.mutate({ type: 'image', mediaId: uploaded.id, replyToMessageId });
      onVoiceSent();
    } catch (err) {
      setCameraError(getApiErrorMessage(err, 'Could not send that photo.'));
    } finally {
      setCameraBusy(false);
    }
  };

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, RECORDER_POLL_MS);
  const recordingRef = useRef(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

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
    setIsLocked(false);
    setIsPaused(false);
    lockedSV.value = 0;
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

  const handleLock = () => setIsLocked(true);

  const togglePauseResume = () => {
    if (isPaused) {
      recorder.record();
      setIsPaused(false);
    } else {
      recorder.pause();
      setIsPaused(true);
    }
  };

  const discardRecording = async () => {
    const uri = recorder.uri;
    await recorder.stop();
    setIsLocked(false);
    setIsPaused(false);
    if (uri) await cleanupFile(uri);
  };

  const sendRecording = async () => {
    if (!whatsappPhoneNumberId) {
      setVoiceError('This conversation has no connected WhatsApp number yet.');
      await discardRecording();
      return;
    }
    // Set busy before stop() resolves so the recording UI stays mounted
    // continuously — otherwise there's a frame where isRecording has
    // flipped false but voiceBusy hasn't flipped true yet, and the
    // composer would flash back to its idle state mid-send.
    setVoiceBusy(true);
    await recorder.stop();
    setIsLocked(false);
    setIsPaused(false);
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

  // The gesture's worklet callbacks (below) always need the LATEST version
  // of these handlers, but the Gesture object itself must stay referentially
  // stable across renders — recreating it on every one of the ~100ms
  // recorderState-driven re-renders during an active hold would tear down
  // and reconfigure the native gesture recognizer mid-touch, which is what
  // broke start/stop/animation in the first build of this feature. A plain
  // ref mirrors the current handlers (updated every render, a normal JS
  // assignment — no cross-thread concerns since it's only ever read from
  // plain JS-thread dispatcher functions below, never from worklet code
  // directly), and the dispatchers themselves are the stable, memoized
  // things the gesture's runOnJS calls actually reference.
  const handlersRef = useRef({ startRecording, handleLock, discardRecording, sendRecording });
  useEffect(() => {
    handlersRef.current = { startRecording, handleLock, discardRecording, sendRecording };
  });

  const dispatchStart = useCallback(() => handlersRef.current.startRecording(), []);
  const dispatchLock = useCallback(() => handlersRef.current.handleLock(), []);
  const dispatchCancel = useCallback(() => handlersRef.current.discardRecording(), []);
  const dispatchSend = useCallback(() => handlersRef.current.sendRecording(), []);

  // Press-and-hold to record, swipe left to cancel, swipe up to lock —
  // spec §10. onBegin fires the instant the finger touches down (before the
  // gesture is even "recognized"), which is what makes the recording feel
  // instantaneous rather than starting after a deliberate drag. Memoized
  // with stable deps only (see handlersRef above) so this is the same
  // Gesture instance for the whole component lifetime — critical for the
  // in-progress touch to survive the frequent re-renders a live recording
  // causes (see the comment above handlersRef for why recreating this per
  // render broke recording in the first version of this feature).
  //
  // eslint-plugin-react-hooks' "refs" check flags every runOnJS(dispatchX)
  // call below as "may read a ref during render", because dispatchStart /
  // dispatchLock / dispatchCancel / dispatchSend transitively read
  // handlersRef.current — but they only do that when actually invoked as
  // gesture callbacks (touch-driven), never during this render. The whole
  // point of routing through these stable dispatchers is to keep this
  // useMemo's dependency array free of anything that changes every render;
  // the static check can't trace that the ref read is deferred behind them.
  /* eslint-disable react-hooks/refs */
  const micGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin(() => {
          runOnJS(dispatchStart)();
        })
        .onUpdate((e) => {
          // Mutating shared values inside a gesture worklet is the
          // documented Reanimated/Gesture Handler pattern for driving
          // UI-thread feedback from a drag — not a real React state
          // mutation. eslint-plugin-react-hooks' immutability check
          // doesn't yet recognize this pattern inside worklets.
          /* eslint-disable react-hooks/immutability */
          micTranslateX.value = Math.min(0, e.translationX);
          micTranslateY.value = Math.min(0, e.translationY);
          if (lockedSV.value === 0 && e.translationY < LOCK_THRESHOLD_Y) {
            lockedSV.value = 1;
            runOnJS(dispatchLock)();
          }
          /* eslint-enable react-hooks/immutability */
        })
        .onEnd((e) => {
          if (lockedSV.value === 0) {
            if (e.translationX < CANCEL_THRESHOLD_X) {
              runOnJS(dispatchCancel)();
            } else {
              runOnJS(dispatchSend)();
            }
          }
          /* eslint-disable react-hooks/immutability */
          micTranslateX.value = withTiming(0);
          micTranslateY.value = withTiming(0);
          /* eslint-enable react-hooks/immutability */
        }),
    [dispatchStart, dispatchLock, dispatchCancel, dispatchSend, micTranslateX, micTranslateY, lockedSV],
  );
  /* eslint-enable react-hooks/refs */

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

  const rowBase = [styles.row, shadow.sm, { backgroundColor: colors.surfaceElevated, borderTopColor: colors.divider, padding: spacing.sm }];

  // Sending the recorded clip (upload in flight) — the gesture has already
  // fully ended by this point (this only happens after onEnd fired), so
  // it's safe for this to be a separate tree from the gesture-holding one.
  if (voiceBusy) {
    return (
      <View style={rowBase}>
        <View style={[styles.recordingRow, { marginHorizontal: spacing.sm }]}>
          <View style={[styles.recordingDot, { backgroundColor: colors.danger, opacity: 0.4 }]} />
          <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>Sending…</Text>
        </View>
      </View>
    );
  }

  // Locked recording — hands-free: pause/resume, delete, send. Also safe as
  // a separate tree: once locked, this composer no longer cares about
  // further updates from that gesture instance (onEnd's cancel/send branch
  // is gated on !locked), so losing it here doesn't drop any functionality.
  if (isLocked && recorderState.isRecording) {
    return (
      <View style={rowBase}>
        <Pressable onPress={discardRecording} hitSlop={8} style={styles.attachButton} accessibilityLabel="Discard recording">
          <Ionicons name="trash-outline" size={22} color={colors.danger} />
        </Pressable>
        <View style={[styles.recordingRow, { marginHorizontal: spacing.sm }]}>
          <View style={[styles.recordingDot, { backgroundColor: colors.danger }]} />
          <Text style={[typography.bodyMedium, { color: colors.textPrimary, marginRight: spacing.sm }]}>
            {formatDuration(recorderState.durationMillis / 1000)}
          </Text>
          <RecordingWaveform metering={recorderState.metering} color={colors.primary} />
        </View>
        <Pressable onPress={togglePauseResume} hitSlop={8} style={styles.attachButton} accessibilityLabel={isPaused ? 'Resume recording' : 'Pause recording'}>
          <Ionicons name={isPaused ? 'mic' : 'pause'} size={20} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          onPress={sendRecording}
          hitSlop={8}
          style={[styles.sendButton, { backgroundColor: colors.primary, borderRadius: radius.full }]}
          accessibilityLabel="Send voice message"
        >
          <Ionicons name="checkmark" size={19} color={colors.textOnPrimary} />
        </Pressable>
      </View>
    );
  }

  // Idle and "holding the mic, not yet locked" share ONE tree below — the
  // GestureDetector must stay mounted continuously across that specific
  // transition, since it's the exact same physical touch: starting the
  // recording (via onBegin) causes recorderState.isRecording to flip true
  // a moment later, and if that swapped in a *different* JSX subtree here,
  // the gesture's underlying native view would be torn down mid-touch —
  // orphaning it, so onUpdate/onEnd would never fire again (no drag
  // animation, no cancel, no lock, no send-on-release). Only the content
  // *around* the gesture button differs between the two states.
  const isHolding = recorderState.isRecording && !isLocked;

  return (
    <View style={rowBase}>
      {isHolding ? (
        <View style={[styles.recordingRow, { marginHorizontal: spacing.sm }]}>
          <View style={[styles.recordingDot, { backgroundColor: colors.danger }]} />
          <Text style={[typography.bodyMedium, { color: colors.textPrimary, marginRight: spacing.sm }]}>
            {formatDuration(recorderState.durationMillis / 1000)}
          </Text>
          <RecordingWaveform metering={recorderState.metering} color={colors.primary} />
          <Ionicons name="chevron-back" size={14} color={colors.textTertiary} />
          <Text style={[typography.caption, { color: colors.textTertiary }]}> Slide to cancel</Text>
        </View>
      ) : (
        <>
          <Pressable onPress={() => setEmojiPickerVisible(true)} hitSlop={8} style={styles.emojiButton} accessibilityLabel="Choose an emoji">
            <Text style={styles.emojiGlyph}>😊</Text>
          </Pressable>

          <View style={[styles.pill, { backgroundColor: colors.surfaceAlt, borderRadius: radius.xl, paddingLeft: spacing.md }]}>
            <TextInput
              value={text}
              onChangeText={handleChangeText}
              onSelectionChange={handleSelectionChange}
              placeholder="Message"
              placeholderTextColor={colors.textTertiary}
              multiline
              style={[styles.input, typography.body, { color: colors.textPrimary }]}
            />
            <Pressable onPress={onAttach} hitSlop={8} style={styles.pillIcon} accessibilityLabel="Add attachment">
              <Ionicons name="attach-outline" size={21} color={colors.textSecondary} />
            </Pressable>
            <Pressable onPress={pickFromCameraQuick} disabled={cameraBusy} hitSlop={8} style={styles.pillIcon} accessibilityLabel="Take a photo">
              <Ionicons name="camera-outline" size={20} color={colors.primary} />
            </Pressable>
          </View>
        </>
      )}

      <View style={styles.actionSlot}>
        {isHolding ? (
          <Animated.View style={[styles.lockHint, lockHintStyle]} pointerEvents="none">
            <Ionicons name="lock-closed-outline" size={16} color={colors.primary} />
            <Ionicons name="chevron-up-outline" size={12} color={colors.primary} />
          </Animated.View>
        ) : null}

        {/* This layer — and the GestureDetector inside it — must be the
            SAME element across the idle↔holding transition above; it is
            unconditionally rendered here (not inside the isHolding ternary)
            specifically so React never unmounts it mid-touch. */}
        <Animated.View style={[styles.actionSlotLayer, micAnimatedStyle]} pointerEvents={canSend ? 'none' : 'auto'}>
          <GestureDetector gesture={micGesture}>
            <Animated.View style={[styles.sendButton, { backgroundColor: colors.primary, borderRadius: radius.full }]}>
              <Ionicons name="mic" size={18} color={colors.textOnPrimary} />
            </Animated.View>
          </GestureDetector>
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

      {!isHolding && (cameraError || voiceError) ? (
        <Text style={[typography.caption, { color: colors.danger, position: 'absolute', top: -18, left: spacing.md }]} numberOfLines={1}>
          {cameraError || voiceError}
        </Text>
      ) : null}
      {isHolding && voiceError ? (
        <Text style={[typography.caption, { color: colors.danger, position: 'absolute', top: -18, left: spacing.md }]} numberOfLines={1}>
          {voiceError}
        </Text>
      ) : null}

      <EmojiPicker visible={emojiPickerVisible} onClose={() => setEmojiPickerVisible(false)} onSelect={handleSelectEmoji} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', borderTopWidth: StyleSheet.hairlineWidth },
  emojiButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  emojiGlyph: { fontSize: 22 },
  attachButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  pill: { flex: 1, flexDirection: 'row', alignItems: 'center', marginHorizontal: 4 },
  input: { flex: 1, maxHeight: 120, paddingVertical: 9, paddingRight: 4 },
  pillIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  actionSlot: { width: 34, height: 34, marginLeft: 2 },
  actionSlotLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  sendButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  lockHint: { position: 'absolute', top: -46, left: 0, right: 0, alignItems: 'center' },
  blockedBar: { borderTopWidth: StyleSheet.hairlineWidth },
  templateButton: { alignItems: 'center' },
  recordingRow: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  recordingDot: { width: 9, height: 9, borderRadius: 5, marginRight: 8 },
  waveform: { flexDirection: 'row', alignItems: 'center' },
  waveformBar: { width: 3, borderRadius: 2, marginHorizontal: 2 },
});
