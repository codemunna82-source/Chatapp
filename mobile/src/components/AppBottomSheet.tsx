import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The imperative surface call sites use. Deliberately the same shape
 * @gorhom/bottom-sheet's BottomSheetModal exposed, so switching the
 * implementation underneath didn't touch a single sheet.
 */
export interface AppBottomSheetRef {
  present: () => void;
  dismiss: () => void;
}

interface AppBottomSheetProps {
  children: React.ReactNode;
  /** Sheet height as a fraction string ('45%') or a number of points. */
  snapPoints?: (string | number)[];
  onDismiss?: () => void;
  /** Fired with 0 when the sheet opens and -1 once it has closed. */
  onChange?: (index: number) => void;
}

const DEFAULT_HEIGHT = '45%';
// How far down the sheet must be dragged before releasing dismisses it.
const DISMISS_DISTANCE = 90;

function resolveHeight(snapPoints: (string | number)[] | undefined, windowHeight: number): number {
  const point = snapPoints?.[0] ?? DEFAULT_HEIGHT;
  if (typeof point === 'number') return point;
  const pct = Number.parseFloat(point);
  return Number.isFinite(pct) ? (windowHeight * pct) / 100 : windowHeight * 0.45;
}

/**
 * A themed bottom sheet: rounded top corners, drag handle, swipe-down and
 * tap-outside to dismiss.
 *
 * Built on React Native's own Modal rather than @gorhom/bottom-sheet, which
 * was the reason the attachment, camera and emoji sheets appeared to do
 * nothing when tapped. gorhom's BottomSheetModalProvider renders its
 * hosting container as a sibling BEFORE {children}:
 *
 *     <BottomSheetHostingContainer />          // painted first
 *     <PortalProvider>{children}</PortalProvider>
 *
 * and that container carries no zIndex or elevation. Later siblings paint
 * on top, and react-native-screens gives navigator screens elevation, so
 * every sheet rendered behind the whole app — it opened correctly and was
 * simply invisible. RN's Modal uses a real native window, so it is always
 * above the app and cannot regress that way.
 */
export const AppBottomSheet = forwardRef<AppBottomSheetRef, AppBottomSheetProps>(function AppBottomSheet(
  { children, snapPoints, onDismiss, onChange },
  ref,
) {
  const { colors, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [visible, setVisible] = useState(false);

  const sheetHeight = useMemo(() => resolveHeight(snapPoints, windowHeight), [snapPoints, windowHeight]);
  const translateY = useSharedValue(0);

  const open = useCallback(() => {
     
    translateY.value = 0;
     
    setVisible(true);
    onChange?.(0);
  }, [onChange, translateY]);

  const close = useCallback(() => {
    setVisible(false);
    onChange?.(-1);
    onDismiss?.();
  }, [onChange, onDismiss]);

  useImperativeHandle(ref, () => ({ present: open, dismiss: close }), [open, close]);

  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        // Vertical only, so a horizontal swipe inside the sheet's content
        // (or a list's own scroll) is never stolen by the dismiss drag.
        .activeOffsetY([-12, 12])
        .failOffsetX([-20, 20])
        .onUpdate((e) => {
           
          translateY.value = Math.max(0, e.translationY);
           
        })
        .onEnd((e) => {
          if (e.translationY > DISMISS_DISTANCE) {
             
            translateY.value = withTiming(sheetHeight, { duration: 160 });
             
            runOnJS(close)();
            return;
          }
           
          translateY.value = withTiming(0, { duration: 160 });
           
        }),
    [close, sheetHeight, translateY],
  );

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root}>
        {/* Backdrop: tapping outside closes. */}
        <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={close} accessibilityLabel="Close" />

        <GestureDetector gesture={dragGesture}>
          <Animated.View
            style={[
              styles.sheet,
              sheetStyle,
              {
                height: sheetHeight + insets.bottom,
                paddingBottom: insets.bottom,
                backgroundColor: colors.surfaceElevated,
                borderTopLeftRadius: radius.xl,
                borderTopRightRadius: radius.xl,
              },
            ]}
          >
            <View style={styles.handleArea}>
              <View style={[styles.handle, { backgroundColor: colors.divider }]} />
            </View>
            <View style={styles.body}>{children}</View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { width: '100%', overflow: 'hidden' },
  handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  handle: { width: 40, height: 4, borderRadius: 2 },
  body: { flex: 1 },
});
