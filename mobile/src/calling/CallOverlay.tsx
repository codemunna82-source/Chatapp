import React, { useEffect, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallStore } from './callStore';
import { useRinger } from './useRinger';
import { impactMedium, notifyError } from '../utils/haptics';

/**
 * The call itself, over everything else.
 *
 * A Modal rather than a screen in the navigator: a call arrives while the
 * user is somewhere else in the app and has to be answerable from there
 * without disturbing the stack they were in — declining a call should put
 * them back exactly where they were, with no navigation to undo.
 *
 * Its palette is fixed dark rather than themed. Every phone shows calls on
 * a dark full-bleed screen, and matching that is what makes the buttons
 * findable in the second the user has to find them.
 */

const CALL_BG = '#101018';
const CALL_SURFACE = '#1E1E2A';
const CALL_TEXT = '#FFFFFF';
const CALL_TEXT_DIM = '#A0A0B4';
const ACCEPT = '#1B9E5A';
const DECLINE = '#D3403F';

/** How long the "Call ended" state stays up before the overlay closes itself. */
const ENDED_DISMISS_MS = 1800;

function initialsOf(label: string): string {
  const trimmed = label.trim();
  return (trimmed[0] ?? '#').toUpperCase();
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The live 0:00 counter, isolated so its per-second tick doesn't re-render the buttons. */
function CallDuration({ connectedAt }: { connectedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - connectedAt) / 1000));

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - connectedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [connectedAt]);

  return <Text style={styles.status}>{formatDuration(Math.max(0, elapsed))}</Text>;
}

/** The halo that pulses behind the avatar while the phone is ringing. */
function PulsingAvatar({ label, pulsing }: { label: string; pulsing: boolean }) {
  // useState's lazy initialiser rather than a ref: the value has to be
  // created exactly once per mount, and reading `ref.current` during render
  // is the pattern React's own lint rule flags.
  const [scale] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!pulsing) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.18, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 900, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      // Reset explicitly: a stopped loop freezes mid-animation, so a call
      // that connects while the halo is expanded would keep it expanded.
      scale.setValue(1);
    };
  }, [pulsing, scale]);

  return (
    <View style={styles.avatarWrap}>
      <Animated.View style={[styles.halo, { transform: [{ scale }] }]} />
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initialsOf(label)}</Text>
      </View>
    </View>
  );
}

function RoundButton({
  icon,
  color,
  label,
  onPress,
  rotated,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  onPress: () => void;
  rotated?: boolean;
}) {
  return (
    <View style={styles.buttonColumn}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.roundButton, { backgroundColor: color, opacity: pressed ? 0.75 : 1 }]}
      >
        <Ionicons name={icon} size={30} color={CALL_TEXT} style={rotated ? styles.rotated : undefined} />
      </Pressable>
      <Text style={styles.buttonLabel}>{label}</Text>
    </View>
  );
}

export function CallOverlay() {
  const phase = useCallStore((s) => s.phase);
  const contactName = useCallStore((s) => s.contactName);
  const fromPhone = useCallStore((s) => s.fromPhone);
  const muted = useCallStore((s) => s.muted);
  const connectedAt = useCallStore((s) => s.connectedAt);
  const message = useCallStore((s) => s.message);
  const answer = useCallStore((s) => s.answer);
  const reject = useCallStore((s) => s.reject);
  const hangUp = useCallStore((s) => s.hangUp);
  const toggleMute = useCallStore((s) => s.toggleMute);
  const dismiss = useCallStore((s) => s.dismiss);

  useRinger(phase === 'ringing');

  // A finished call closes itself. Leaving "Call ended" on screen until it
  // is tapped away turns every call into two actions instead of one.
  useEffect(() => {
    if (phase !== 'ended') return;
    const id = setTimeout(() => useCallStore.getState().dismiss(), ENDED_DISMISS_MS);
    return () => clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase === 'failed') notifyError();
  }, [phase]);

  if (phase === 'idle') return null;

  const displayName = contactName?.trim() || fromPhone || 'Unknown caller';
  const showNumber = Boolean(fromPhone) && displayName !== fromPhone;

  return (
    <Modal visible animationType="fade" onRequestClose={phase === 'ringing' ? reject : dismiss} statusBarTranslucent>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.badge}>WhatsApp call</Text>
        </View>

        <View style={styles.identity}>
          <PulsingAvatar label={displayName} pulsing={phase === 'ringing'} />
          <Text style={styles.name} numberOfLines={1}>
            {displayName}
          </Text>
          {showNumber ? <Text style={styles.number}>{fromPhone}</Text> : null}

          {phase === 'ringing' ? <Text style={styles.status}>Incoming call…</Text> : null}
          {phase === 'connecting' ? <Text style={styles.status}>Connecting…</Text> : null}
          {phase === 'active' && connectedAt ? <CallDuration connectedAt={connectedAt} /> : null}
          {phase === 'ended' || phase === 'failed' ? (
            <Text style={[styles.status, phase === 'failed' && styles.statusError]}>{message ?? 'Call ended'}</Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          {phase === 'ringing' ? (
            <>
              <RoundButton
                icon="call"
                color={DECLINE}
                label="Decline"
                rotated
                onPress={() => {
                  impactMedium();
                  void reject();
                }}
              />
              <RoundButton
                icon="call"
                color={ACCEPT}
                label="Answer"
                onPress={() => {
                  impactMedium();
                  void answer();
                }}
              />
            </>
          ) : null}

          {phase === 'connecting' || phase === 'active' ? (
            <>
              <RoundButton
                icon={muted ? 'mic-off' : 'mic'}
                color={muted ? '#4C3FE0' : CALL_SURFACE}
                label={muted ? 'Unmute' : 'Mute'}
                onPress={toggleMute}
              />
              <RoundButton
                icon="call"
                color={DECLINE}
                label="End"
                rotated
                onPress={() => {
                  impactMedium();
                  void hangUp();
                }}
              />
            </>
          ) : null}

          {phase === 'ended' || phase === 'failed' ? (
            <RoundButton icon="close" color={CALL_SURFACE} label="Close" onPress={dismiss} />
          ) : null}
        </View>

        <Text style={styles.footnote}>
          {phase === 'active' || phase === 'connecting'
            ? 'Audio plays through the earpiece — use a headset for hands-free.'
            : ' '}
        </Text>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CALL_BG, justifyContent: 'space-between', paddingBottom: 28 },
  header: { alignItems: 'center', paddingTop: 24 },
  badge: {
    color: CALL_TEXT_DIM,
    fontSize: 12.5,
    fontWeight: '600',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  identity: { alignItems: 'center', paddingHorizontal: 32, gap: 6 },
  avatarWrap: { width: 148, height: 148, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  halo: { position: 'absolute', width: 148, height: 148, borderRadius: 74, backgroundColor: 'rgba(76,63,224,0.22)' },
  avatar: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: '#4C3FE0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: CALL_TEXT, fontSize: 44, fontWeight: '600' },
  name: { color: CALL_TEXT, fontSize: 26, fontWeight: '600', letterSpacing: -0.4, textAlign: 'center' },
  number: { color: CALL_TEXT_DIM, fontSize: 15.5 },
  status: { color: CALL_TEXT_DIM, fontSize: 15.5, marginTop: 10 },
  statusError: { color: '#FF8A87', textAlign: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 44, paddingHorizontal: 32 },
  buttonColumn: { alignItems: 'center', gap: 10 },
  roundButton: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  rotated: { transform: [{ rotate: '135deg' }] },
  buttonLabel: { color: CALL_TEXT_DIM, fontSize: 12.5, fontWeight: '600' },
  footnote: { color: '#6C6C82', fontSize: 12, textAlign: 'center', paddingHorizontal: 32, minHeight: 16 },
});
