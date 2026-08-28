import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import { emitTypingStart, emitTypingStop } from '../../sockets/actions';
import { useUploadMedia } from '../../queries/useUploadMedia';
import { useSendMessage } from '../../queries/useMessages';
import { getApiErrorMessage } from '../../api/client';
import { formatDuration } from '../../utils/formatTime';
import { useMessageDraft } from '../../utils/useMessageDraft';
import { MediaSourceSheet } from './MediaSourceSheet';

interface ComposerProps {
  conversationId: string;
  whatsappPhoneNumberId: string | undefined;
  withinWindow: boolean;
  onSendText: (text: string) => void;
  onAttach: () => void;
  onUseTemplate: () => void;
  sending: boolean;
  replyToMessageId: string | undefined;
  /** Fired after any send this component performs itself, so the screen can clear the reply target. */
  onSent: () => void;
}

/** An image picked but not yet sent — shown as a removable thumbnail above the input. */
interface PendingImage {
  uri: string;
  name: string;
  mimeType: string;
}

const TYPING_STOP_DELAY_MS = 2500;
const RECORDER_POLL_MS = 100;
const MAX_IMAGES_PER_SEND = 10;
const INPUT_MIN_HEIGHT = 22;
const INPUT_MAX_HEIGHT = 120;
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
    // Mutating .value inside useEffect is Reanimated's documented pattern.
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

/**
 * The live timer + waveform, in its own component **on purpose**.
 *
 * expo-audio's useAudioRecorderState installs a setInterval that calls the
 * native recorder's getStatus() on every tick, for as long as the calling
 * component is mounted — its effect keys only on recorder.id, so the poll
 * interval can't be changed after mount. Calling it from the Composer meant
 * 10 native status calls a second for the entire time any chat was open,
 * competing with touch dispatch on the JS thread even though nothing was
 * being recorded. Mounting the hook here, and this component only while a
 * recording is actually running, confines that cost to when it's needed.
 */
function RecordingReadout({
  recorder,
  paused,
  dotColor,
  textColor,
  waveColor,
  textStyle,
  gap,
}: {
  recorder: ReturnType<typeof useAudioRecorder>;
  paused: boolean;
  dotColor: string;
  textColor: string;
  waveColor: string;
  textStyle: object;
  gap: number;
}) {
  const state = useAudioRecorderState(recorder, RECORDER_POLL_MS);
  return (
    <View style={styles.recordingRow}>
      <View style={[styles.recordingDot, { backgroundColor: dotColor }]} />
      <Text style={[textStyle, { color: textColor, marginRight: gap }]}>{formatDuration(state.durationMillis / 1000)}</Text>
      <RecordingWaveform metering={paused ? 0 : state.metering} color={waveColor} />
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
  onSent,
}: ComposerProps) {
  const { colors, spacing, radius, typography } = useTheme();
  // The bottom inset is owned by the screen's keyboard-tracking wrapper
  // (see ConversationDetailScreen's useAnimatedKeyboard padding), which
  // resolves the navigation bar and the keyboard as one value. The composer
  // only owns its own internal breathing room — applying an inset here too
  // would stack into a dead gap above the keyboard.
  const bottomPad = 6;
  // Restore any half-typed message for this chat. Lazy initial state rather
  // than an effect, so the field is already populated on first paint.
  const draft = useMessageDraft(conversationId);
  const [text, setText] = useState(() => draft.read());
  const [inputHeight, setInputHeight] = useState(INPUT_MIN_HEIGHT);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const uploadMedia = useUploadMedia();
  const sendMessage = useSendMessage(conversationId);

  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [mediaSheetOpen, setMediaSheetOpen] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const canSend = (Boolean(text.trim()) || pendingImages.length > 0) && !sending && !mediaBusy;

  const handleChangeText = (value: string) => {
    setText(value);
    draft.save(value);
    emitTypingStart(conversationId);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => emitTypingStop(conversationId), TYPING_STOP_DELAY_MS);
  };

  const handleContentSizeChange = (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
    // Grow the input with its content up to a cap, then let it scroll —
    // keeps the icon row on one line no matter how long the message is.
    const next = Math.min(INPUT_MAX_HEIGHT, Math.max(INPUT_MIN_HEIGHT, e.nativeEvent.contentSize.height));
    setInputHeight(next);
  };

  useEffect(
    () => () => {
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      // Commit whatever the debounce hasn't written yet, so a fast
      // back-navigation doesn't lose the last few characters.
      draft.flush();
    },
    [draft],
  );

  // ---------------------------------------------------------------- images
  const addAssets = (assets: ImagePicker.ImagePickerAsset[]) => {
    const picked: PendingImage[] = assets.map((asset, i) => ({
      uri: asset.uri,
      name: asset.fileName ?? `image-${Date.now()}-${i}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
    }));
    // Selection order is preserved, and the cap is enforced across repeated
    // picks rather than per pick.
    setPendingImages((prev) => [...prev, ...picked].slice(0, MAX_IMAGES_PER_SEND));
  };

  const pickFromGallery = async () => {
    setMediaError(null);
    setMediaSheetOpen(false);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES_PER_SEND,
      quality: 0.8,
    });
    if (result.canceled) return;
    addAssets(result.assets);
  };

  const captureFromCamera = async () => {
    setMediaError(null);
    setMediaSheetOpen(false);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setMediaError('Camera permission was denied — enable it in Android Settings to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled) return;
    addAssets(result.assets);
  };

  const removePendingImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  /** Uploads and sends each pending image in order. Returns false if it bailed. */
  const sendPendingImages = async (caption: string): Promise<boolean> => {
    if (!whatsappPhoneNumberId) {
      setMediaError('This conversation has no connected WhatsApp number yet.');
      return false;
    }
    setMediaBusy(true);
    setMediaError(null);
    try {
      // Sequential on purpose: it preserves the order the user picked, and
      // the caption belongs on the first image only (same as WhatsApp).
      for (let i = 0; i < pendingImages.length; i++) {
        const image = pendingImages[i];
        if (!image) continue;
        const uploaded = await uploadMedia.mutateAsync({ whatsappPhoneNumberId, file: image });
        sendMessage.mutate({
          type: 'image',
          mediaId: uploaded.id,
          caption: i === 0 && caption ? caption : undefined,
          replyToMessageId,
        });
      }
      setPendingImages([]);
      onSent();
      return true;
    } catch (err) {
      setMediaError(getApiErrorMessage(err, 'Could not send those photos.'));
      return false;
    } finally {
      setMediaBusy(false);
    }
  };

  const handleSend = async () => {
    if (!canSend || sendingRef.current) return;
    sendingRef.current = true;
    try {
      await performSend();
    } finally {
      sendingRef.current = false;
    }
  };

  const performSend = async () => {
    const trimmed = text.trim();

    if (pendingImages.length > 0) {
      // The typed text rides along as the first image's caption rather than
      // being sent as a separate message.
      const ok = await sendPendingImages(trimmed);
      if (ok) {
        setText('');
        draft.clear();
        setInputHeight(INPUT_MIN_HEIGHT);
      }
    } else {
      onSendText(trimmed);
      setText('');
      draft.clear();
      setInputHeight(INPUT_MIN_HEIGHT);
    }

    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    emitTypingStop(conversationId);
  };

  // ----------------------------------------------------------- voice notes
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Tracked here rather than read from useAudioRecorderState: this component
  // is the only thing that starts and stops the recorder, so it already
  // knows, and owning the flag lets the polling hook stay unmounted while
  // idle (see RecordingReadout).
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [recordedMs, setRecordedMs] = useState(0);

  const previewPlayer = useAudioPlayer(previewUri ?? undefined);
  const previewStatus = useAudioPlayerStatus(previewPlayer);

  // Mirrors of live state that the unmount cleanup below needs to read
  // without re-subscribing (an effect with these in its dep list would tear
  // down and re-arm the cleanup on every recorder poll).
  const isRecordingRef = useRef(false);
  const previewUriRef = useRef<string | null>(null);
  // Synchronous re-entry guards: `mediaBusy`/`isRecording` only update on the
  // next render, so a fast double tap can slip a second call through before
  // either flips. Refs close that window.
  const startingRef = useRef(false);
  const sendingRef = useRef(false);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);
  useEffect(() => {
    previewUriRef.current = previewUri;
  }, [previewUri]);

  const deleteFile = useCallback(async (uri: string) => {
    try {
      await new File(uri).delete();
    } catch {
      // Best-effort cache cleanup — a leftover temp file isn't worth surfacing.
    }
  }, []);

  useEffect(
    () => () => {
      // Leaving the screen mid-recording (or with an unsent take) must
      // release the mic and not strand a temp file in the cache.
      if (isRecordingRef.current) {
        recorder.stop().catch(() => undefined);
        setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      }
      const stranded = previewUriRef.current;
      if (stranded) {
        try {
          new File(stranded).delete();
        } catch {
          // Best-effort — the OS clears the cache dir anyway.
        }
      }
    },
    [recorder],
  );

  const startRecording = async () => {
    if (startingRef.current || isRecording) return;
    startingRef.current = true;
    setVoiceError(null);
    setIsPaused(false);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setVoiceError('Microphone permission was denied — enable it in Android Settings to send voice messages.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
    } catch {
      setVoiceError('Could not start recording on this device.');
      // Never leave the audio session in record mode after a failed start.
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    } finally {
      startingRef.current = false;
    }
  };

  /** Stops the recorder and moves to the preview state — the mic is released here. */
  const stopRecording = async () => {
    // Read straight from the recorder rather than the (up to 100ms stale)
    // polled snapshot.
    const duration = recorder.getStatus().durationMillis;
    try {
      await recorder.stop();
    } catch {
      setVoiceError('Recording stopped unexpectedly.');
    }
    setIsRecording(false);
    setIsPaused(false);
    // Back out of record mode so playback routes to the speaker rather than
    // the earpiece, and the mic indicator clears.
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    const uri = recorder.uri;
    if (!uri) {
      setVoiceError('That recording came back empty — try again.');
      return;
    }
    setRecordedMs(duration);
    setPreviewUri(uri);
  };

  const togglePauseResume = () => {
    if (isPaused) {
      recorder.record();
      setIsPaused(false);
    } else {
      recorder.pause();
      setIsPaused(true);
    }
  };

  const togglePreviewPlayback = async () => {
    if (previewStatus.playing) {
      previewPlayer.pause();
      return;
    }
    if (previewStatus.duration > 0 && previewStatus.currentTime >= previewStatus.duration) {
      await previewPlayer.seekTo(0);
    }
    previewPlayer.play();
  };

  /** Throws away the take (recording or preview) and releases everything. */
  const discardRecording = async () => {
    if (isRecording) {
      await recorder.stop().catch(() => undefined);
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
    setIsRecording(false);
    setIsPaused(false);
    setVoiceError(null);
    const uri = previewUri ?? recorder.uri;
    setPreviewUri(null);
    setRecordedMs(0);
    if (uri) await deleteFile(uri);
  };

  const sendRecording = async () => {
    if (!previewUri || sendingRef.current) return;
    sendingRef.current = true;
    if (!whatsappPhoneNumberId) {
      setVoiceError('This conversation has no connected WhatsApp number yet.');
      return;
    }
    setVoiceBusy(true);
    const uri = previewUri;
    try {
      const uploaded = await uploadMedia.mutateAsync({
        whatsappPhoneNumberId,
        file: { uri, name: `voice-${Date.now()}.m4a`, mimeType: 'audio/mp4' },
      });
      sendMessage.mutate({ type: 'audio', mediaId: uploaded.id, replyToMessageId });
      setPreviewUri(null);
      setRecordedMs(0);
      onSent();
      await deleteFile(uri);
    } catch (err) {
      // Keep the take on failure so the recording isn't lost — the user can
      // retry the send or discard it deliberately.
      setVoiceError(getApiErrorMessage(err, 'Could not send that voice message.'));
    } finally {
      setVoiceBusy(false);
      sendingRef.current = false;
    }
  };

  // ------------------------------------------------------------ rendering
  const shellStyle = [
    styles.shell,
    {
      backgroundColor: colors.surfaceElevated,
      borderTopColor: colors.divider,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: bottomPad,
    },
  ];

  // Spec §18: outside the 24h window, only an approved template may be
  // sent — enforced server-side regardless, but the composer shouldn't
  // invite a free-form send that's guaranteed to be rejected.
  if (!withinWindow) {
    return (
      <View style={[shellStyle, { paddingBottom: bottomPad + spacing.sm }]}>
        <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
          It&apos;s been over 24 hours since this contact last messaged you — send an approved template to continue.
        </Text>
        <Pressable
          onPress={onUseTemplate}
          style={[styles.templateButton, { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.sm }]}
          accessibilityRole="button"
          accessibilityLabel="Use a template"
        >
          <Text style={[typography.bodyMedium, { color: colors.textOnPrimary, textAlign: 'center' }]}>Use a template</Text>
        </Pressable>
      </View>
    );
  }

  const errorText = mediaError ?? voiceError;

  // --- recording in progress: an explicit, always-visible Stop button ---
  if (isRecording) {
    return (
      <View style={shellStyle}>
        {errorText ? <Text style={[typography.caption, { color: colors.danger, marginBottom: 4 }]}>{errorText}</Text> : null}
        <View style={styles.row}>
          <Pressable
            onPress={discardRecording}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Discard recording"
          >
            {({ pressed }) => (
              <Ionicons name="trash-outline" size={22} color={colors.danger} style={{ opacity: pressed ? 0.5 : 1 }} />
            )}
          </Pressable>

          <RecordingReadout
            recorder={recorder}
            paused={isPaused}
            dotColor={isPaused ? colors.textTertiary : colors.danger}
            textColor={colors.textPrimary}
            waveColor={colors.primary}
            textStyle={typography.bodyMedium}
            gap={spacing.sm}
          />

          <Pressable
            onPress={togglePauseResume}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={isPaused ? 'Resume recording' : 'Pause recording'}
          >
            {({ pressed }) => (
              <Ionicons
                name={isPaused ? 'play' : 'pause'}
                size={20}
                color={colors.textSecondary}
                style={{ opacity: pressed ? 0.5 : 1 }}
              />
            )}
          </Pressable>

          <Pressable
            onPress={stopRecording}
            style={styles.actionTouch}
            accessibilityRole="button"
            accessibilityLabel="Stop recording"
          >
            {({ pressed }) => (
              <View style={[styles.actionCircle, { backgroundColor: colors.danger, opacity: pressed ? 0.6 : 1 }]}>
                <Ionicons name="stop" size={18} color={colors.textOnPrimary} />
              </View>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  // --- recorded, not yet sent: play / discard / send ---
  if (previewUri) {
    return (
      <View style={shellStyle}>
        {errorText ? <Text style={[typography.caption, { color: colors.danger, marginBottom: 4 }]}>{errorText}</Text> : null}
        <View style={styles.row}>
          <Pressable
            onPress={discardRecording}
            disabled={voiceBusy}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Delete recording"
          >
            {({ pressed }) => (
              <Ionicons
                name="trash-outline"
                size={22}
                color={colors.danger}
                style={{ opacity: voiceBusy ? 0.4 : pressed ? 0.5 : 1 }}
              />
            )}
          </Pressable>

          <View style={[styles.previewPill, { backgroundColor: colors.surfaceAlt, borderRadius: radius.xl }]}>
            <Pressable
              onPress={togglePreviewPlayback}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel={previewStatus.playing ? 'Pause playback' : 'Play recording'}
            >
              {({ pressed }) => (
                <Ionicons
                  name={previewStatus.playing ? 'pause' : 'play'}
                  size={20}
                  color={colors.primary}
                  style={{ opacity: pressed ? 0.5 : 1 }}
                />
              )}
            </Pressable>
            <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>
              {formatDuration(
                (previewStatus.isLoaded && previewStatus.duration > 0
                  ? previewStatus.duration - previewStatus.currentTime
                  : recordedMs / 1000) || 0,
              )}
            </Text>
            <Text style={[typography.caption, { color: colors.textTertiary, marginLeft: spacing.sm }]}>Voice message</Text>
          </View>

          <Pressable
            onPress={sendRecording}
            disabled={voiceBusy}
            style={styles.actionTouch}
            accessibilityRole="button"
            accessibilityState={{ disabled: voiceBusy }}
            accessibilityLabel="Send voice message"
          >
            {({ pressed }) => (
              <View
                style={[
                  styles.actionCircle,
                  { backgroundColor: colors.primary, opacity: voiceBusy ? 0.5 : pressed ? 0.6 : 1 },
                ]}
              >
                <Ionicons name="send" size={17} color={colors.textOnPrimary} style={styles.sendGlyph} />
              </View>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  // --- idle: [attach] [input] [camera] [mic | send] ---
  return (
    <View style={shellStyle}>
      {errorText ? <Text style={[typography.caption, { color: colors.danger, marginBottom: 4 }]}>{errorText}</Text> : null}

      {pendingImages.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.previewStrip}
          contentContainerStyle={styles.previewStripContent}
          keyboardShouldPersistTaps="handled"
        >
          {pendingImages.map((image, index) => (
            <View key={`${image.uri}-${index}`} style={[styles.thumbWrap, { borderRadius: radius.md, borderColor: colors.border }]}>
              <Image source={{ uri: image.uri }} style={[styles.thumb, { borderRadius: radius.md }]} />
              <Pressable
                onPress={() => removePendingImage(index)}
                disabled={mediaBusy}
                style={styles.thumbRemove}
                accessibilityRole="button"
                accessibilityLabel={`Remove image ${index + 1}`}
              >
                <View style={[styles.thumbRemoveDot, { backgroundColor: colors.overlay }]}>
                  <Ionicons name="close" size={13} color="#FFFFFF" />
                </View>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.row}>
        <Pressable onPress={onAttach} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Add attachment">
          {({ pressed }) => (
            <Ionicons name="add-circle-outline" size={26} color={colors.textSecondary} style={{ opacity: pressed ? 0.5 : 1 }} />
          )}
        </Pressable>

        <View style={[styles.pill, { backgroundColor: colors.surfaceAlt, borderRadius: radius.xl, borderColor: colors.border }]}>
          <TextInput
            value={text}
            onChangeText={handleChangeText}
            onContentSizeChange={handleContentSizeChange}
            placeholder="Type a message..."
            placeholderTextColor={colors.textTertiary}
            multiline
            style={[styles.input, typography.body, { color: colors.textPrimary, height: inputHeight }]}
          />
        </View>

        <Pressable
          onPress={() => setMediaSheetOpen(true)}
          disabled={mediaBusy}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityState={{ disabled: mediaBusy }}
          accessibilityLabel="Take a photo or choose from gallery"
        >
          {({ pressed }) => (
            <Ionicons
              name="camera-outline"
              size={24}
              color={colors.textSecondary}
              style={{ opacity: mediaBusy ? 0.4 : pressed ? 0.5 : 1 }}
            />
          )}
        </Pressable>

        {canSend ? (
          <Pressable
            onPress={handleSend}
            style={styles.actionTouch}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            {({ pressed }) => (
              <View style={[styles.actionCircle, { backgroundColor: colors.primary, opacity: pressed ? 0.6 : 1 }]}>
                <Ionicons name="send" size={17} color={colors.textOnPrimary} style={styles.sendGlyph} />
              </View>
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={startRecording}
            disabled={mediaBusy}
            style={styles.actionTouch}
            accessibilityRole="button"
            accessibilityState={{ disabled: mediaBusy }}
            accessibilityLabel="Record a voice message"
          >
            {({ pressed }) => (
              <View
                style={[
                  styles.actionCircle,
                  { backgroundColor: colors.primary, opacity: mediaBusy ? 0.5 : pressed ? 0.6 : 1 },
                ]}
              >
                <Ionicons name="mic" size={19} color={colors.textOnPrimary} />
              </View>
            )}
          </Pressable>
        )}
      </View>

      <MediaSourceSheet
        visible={mediaSheetOpen}
        onClose={() => setMediaSheetOpen(false)}
        onPickCamera={captureFromCamera}
        onPickGallery={pickFromGallery}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  // Every control is a real 48dp touch square regardless of its icon size —
  // see touchTarget in theme/spacing.ts.
  iconButton: { width: touchTarget.min, height: touchTarget.min, alignItems: 'center', justifyContent: 'center' },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touchTarget.min,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, paddingTop: 0, paddingBottom: 0, textAlignVertical: 'center' },
  actionTouch: { width: touchTarget.min, height: touchTarget.min, alignItems: 'center', justifyContent: 'center' },
  actionCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  // Ionicons' send glyph is optically left-heavy inside a circle.
  sendGlyph: { marginLeft: 2 },
  previewStrip: { maxHeight: 84 },
  previewStripContent: { paddingBottom: 8, paddingLeft: 4 },
  thumbWrap: { marginRight: 8, borderWidth: StyleSheet.hairlineWidth },
  thumb: { width: 64, height: 64 },
  thumbRemove: { position: 'absolute', top: -6, right: -6, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  thumbRemoveDot: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  previewPill: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: touchTarget.min, paddingRight: 14, marginHorizontal: 2 },
  templateButton: { alignItems: 'center' },
  recordingRow: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  recordingDot: { width: 9, height: 9, borderRadius: 5, marginRight: 8 },
  waveform: { flexDirection: 'row', alignItems: 'center' },
  waveformBar: { width: 3, borderRadius: 2, marginHorizontal: 2 },
});
