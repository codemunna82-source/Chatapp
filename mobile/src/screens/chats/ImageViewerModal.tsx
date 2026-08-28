import React, { useCallback, useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { touchTarget } from '../../theme/spacing';

interface ImageViewerModalProps {
  /** Local (cached) file uri of the image to show; null closes the viewer. */
  uri: string | null;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;

/**
 * Full-screen photo viewer with pinch-to-zoom and pan.
 *
 * Takes an already-downloaded local uri rather than the media id: the
 * bubble has cached the file to disk already (see MediaImage), so opening
 * a photo costs no extra network request and works offline.
 *
 * The gestures run entirely on the UI thread via Reanimated shared values,
 * so zooming stays smooth even while the chat behind it is busy.
 */
export function ImageViewerModal({ uri, onClose }: ImageViewerModalProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const reset = useCallback(() => {
    /* eslint-disable react-hooks/immutability -- shared-value writes are Reanimated's documented API */
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedX.value = 0;
    savedY.value = 0;
    /* eslint-enable react-hooks/immutability */
  }, [scale, savedScale, translateX, translateY, savedX, savedY]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onUpdate((e) => {
        /* eslint-disable react-hooks/immutability */
        const next = savedScale.value * e.scale;
        scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
        /* eslint-enable react-hooks/immutability */
      })
      .onEnd(() => {
        /* eslint-disable react-hooks/immutability */
        savedScale.value = scale.value;
        // Snapping back to fit when zoomed all the way out also re-centres,
        // so the image can't be left stranded off-screen.
        if (scale.value <= MIN_SCALE) {
          translateX.value = withTiming(0);
          translateY.value = withTiming(0);
          savedX.value = 0;
          savedY.value = 0;
        }
        /* eslint-enable react-hooks/immutability */
      });

    const pan = Gesture.Pan()
      // Only pan once zoomed in; at fit-scale the drag would just slide the
      // image around inside a screen it already fills.
      .onUpdate((e) => {
        if (scale.value <= MIN_SCALE) return;
        /* eslint-disable react-hooks/immutability */
        translateX.value = savedX.value + e.translationX;
        translateY.value = savedY.value + e.translationY;
        /* eslint-enable react-hooks/immutability */
      })
      .onEnd(() => {
        /* eslint-disable react-hooks/immutability */
        savedX.value = translateX.value;
        savedY.value = translateY.value;
        /* eslint-enable react-hooks/immutability */
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        /* eslint-disable react-hooks/immutability */
        const zoomed = scale.value > MIN_SCALE;
        scale.value = withTiming(zoomed ? MIN_SCALE : 2);
        savedScale.value = zoomed ? MIN_SCALE : 2;
        if (zoomed) {
          translateX.value = withTiming(0);
          translateY.value = withTiming(0);
          savedX.value = 0;
          savedY.value = 0;
        }
        /* eslint-enable react-hooks/immutability */
      });

    // Pinch and pan must be able to run together, and the double tap has to
    // lose to neither.
    return Gesture.Simultaneous(pinch, pan, doubleTap);
  }, [scale, savedScale, translateX, translateY, savedX, savedY]);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <Modal visible={Boolean(uri)} transparent={false} animationType="fade" onRequestClose={handleClose} statusBarTranslucent>
      <View style={styles.root}>
        <GestureDetector gesture={gesture}>
          <Animated.View style={styles.canvas}>
            {uri ? (
              <Animated.Image
                source={{ uri }}
                style={[{ width, height: height * 0.8 }, imageStyle]}
                resizeMode="contain"
              />
            ) : null}
          </Animated.View>
        </GestureDetector>

        <Pressable
          onPress={handleClose}
          style={[styles.close, { top: insets.top + 8 }]}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
        >
          {({ pressed }) => (
            <View style={[styles.closeDot, { opacity: pressed ? 0.6 : 1 }]}>
              <Ionicons name="close" size={22} color="#FFFFFF" />
            </View>
          )}
        </Pressable>

        <Text style={[styles.hint, { bottom: insets.bottom + 16 }]}>Pinch or double-tap to zoom</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Deliberately a fixed near-black rather than a theme token: a photo
  // viewer reads best on black in either app theme.
  root: { flex: 1, backgroundColor: '#000000' },
  canvas: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', right: 8, width: touchTarget.min, height: touchTarget.min, alignItems: 'center', justifyContent: 'center' },
  closeDot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { position: 'absolute', alignSelf: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 12.5 },
});
