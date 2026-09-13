import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { touchTarget } from '../../theme/spacing';
import { downloadMedia } from './mediaCache';
import { useAuthStore } from '../../store/authStore';

/** One photo the viewer can show. */
export interface ViewerPhoto {
  /** The message this photo belongs to, so a reply has something to quote. */
  messageId: string;
  /** The bubble's already-downloaded file. */
  uri: string;
  mediaId?: string;
}

interface ImageViewerModalProps {
  /**
   * Every photo in the album this was opened from, so all of them are
   * reachable — including the ones behind the "+N" tile, which the grid
   * has no room to draw and which were, until now, impossible to open,
   * reply to or forward at all.
   *
   * A single photo is an album of one.
   */
  photos?: ViewerPhoto[];
  /** Which of them to show first. */
  index?: number;
  /** Replying closes the viewer and quotes the photo on screen. */
  onReply?: (messageId: string) => void;
  /** Local (cached) file uri of the image to show; null closes the viewer. */
  uri: string | null;
  /**
   * The server id of the same photo, when it has one.
   *
   * The bubble downloads a version sized for a bubble. Zoomed to 4x on a
   * full screen that would be visibly soft, so the original is fetched
   * once the viewer opens and swapped in underneath — the thumbnail is on
   * screen the whole time, so opening a photo is still instant.
   */
  mediaId?: string;
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
export function ImageViewerModal({
  uri,
  mediaId,
  photos,
  index = 0,
  onReply,
  onClose,
}: ImageViewerModalProps) {
  const { width, height } = useWindowDimensions();

  /**
   * Which photo of the album is on screen.
   *
   * Tagged with the album it belongs to, for the same reason everything
   * else here is: the viewer is reused, and an index left over from a
   * five-photo album would point past the end of the next one.
   */
  const albumKey = photos?.map((p) => p.messageId).join('|') ?? '';
  const [picked, setPicked] = useState<{ key: string; at: number } | null>(null);
  const current = picked && picked.key === albumKey ? picked.at : index;
  const active = photos?.[current];

  // The chosen photo when there is an album, the single uri otherwise.
  const sourceUri = active?.uri ?? uri;
  const sourceMediaId = active?.mediaId ?? mediaId;
  const insets = useSafeAreaInsets();
  const accessToken = useAuthStore((s) => s.accessToken);
  /**
   * The original, tagged with the photo it belongs to.
   *
   * Tagged rather than cleared on every change, so a download that
   * finishes after the user has swiped to the next photo cannot paint
   * itself over that one — and so this effect never has to reset state
   * synchronously just to stay honest.
   */
  const [full, setFull] = useState<{ mediaId: string; uri: string } | null>(null);

  useEffect(() => {
    if (!sourceUri || !sourceMediaId) return;

    let cancelled = false;
    (async () => {
      try {
        const upgraded = await downloadMedia(sourceMediaId, accessToken);
        if (!cancelled) setFull({ mediaId: sourceMediaId, uri: upgraded });
      } catch {
        // The thumbnail stays. A failed upgrade is a slightly soft photo,
        // not a broken viewer, and there is nothing for the user to do
        // about it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceUri, sourceMediaId, accessToken]);

  // The sharper file once it has landed FOR THIS PHOTO, the bubble's copy
  // until then.
  const displayUri = (sourceMediaId && full?.mediaId === sourceMediaId ? full.uri : null) ?? sourceUri;

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
            {displayUri ? (
              <Animated.Image
                source={{ uri: displayUri }}
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

        {/* Reply, on whichever photo is on screen. The whole point of the
            strip below: a photo behind "+N" had no bubble to long-press,
            so there was no way to answer one of five pictures. */}
        {onReply && active ? (
          <Pressable
            onPress={() => {
              const target = active.messageId;
              handleClose();
              onReply(target);
            }}
            style={[styles.reply, { top: insets.top + 8 }]}
            accessibilityRole="button"
            accessibilityLabel="Reply to this photo"
          >
            {({ pressed }) => (
              <View style={[styles.closeDot, { opacity: pressed ? 0.6 : 1 }]}>
                <Ionicons name="arrow-undo-outline" size={20} color="#FFFFFF" />
              </View>
            )}
          </Pressable>
        ) : null}

        {/* Tapped, not swiped. The picture itself owns pinch, pan and
            double-tap; a horizontal swipe on top of those fights the pan
            the moment anyone is zoomed in, and loses in a way that feels
            broken. A strip is unambiguous and shows how many there are. */}
        {photos && photos.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.strip, { bottom: insets.bottom + 12 }]}
            contentContainerStyle={styles.stripInner}
          >
            {photos.map((photo, i) => (
              <Pressable
                key={photo.messageId}
                onPress={() => setPicked({ key: albumKey, at: i })}
                accessibilityRole="button"
                accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
              >
                <Image
                  source={{ uri: photo.uri }}
                  style={[styles.thumb, i === current && styles.thumbActive]}
                  resizeMode="cover"
                />
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <Text style={[styles.hint, { bottom: insets.bottom + 16 }]}>Pinch or double-tap to zoom</Text>
        )}
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
  reply: { position: 'absolute', left: 8, width: touchTarget.min, height: touchTarget.min, alignItems: 'center', justifyContent: 'center' },
  strip: { position: 'absolute', left: 0, right: 0, maxHeight: 64 },
  stripInner: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  thumb: { width: 52, height: 52, borderRadius: 6, opacity: 0.5 },
  // The one on screen, marked by being the only one at full strength.
  thumbActive: { opacity: 1, borderWidth: 2, borderColor: '#FFFFFF' },
});
