import React, { forwardRef, useCallback, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useTheme } from '../theme/ThemeProvider';

// Every sheet in this app that relied on enableDynamicSizing failed to
// appear at all on a real device — it presents at zero height, so the tap
// looks like it did nothing. The emoji picker hit this and was fixed by
// giving it explicit snap points; the attachment and media-source sheets
// then hit exactly the same thing. So dynamic sizing is no longer the
// default: a sheet gets a real height unless it deliberately opts in.
const DEFAULT_SNAP_POINTS: (string | number)[] = ['45%'];

interface AppBottomSheetProps {
  children: React.ReactNode;
  /** Fixed snap points. Defaults to a real height — see DEFAULT_SNAP_POINTS. */
  snapPoints?: (string | number)[];
  /**
   * Opt in to content-driven height. Only use this with content whose
   * measured height is reliable, and verify it on a device — see the note
   * above DEFAULT_SNAP_POINTS.
   */
  dynamicSizing?: boolean;
  onDismiss?: () => void;
  /**
   * Forwards the underlying sheet's index-change event — a real callback
   * fired by the library, not a React effect, so it's the correct place to
   * reset a sheet's local ephemeral state (a search query, a stale error)
   * when it opens, without triggering the "setState in an effect" lint rule.
   */
  onChange?: (index: number) => void;
}

/**
 * A single themed BottomSheetModal shell — real rounded-top-corner sheet,
 * drag handle, swipe-down-to-dismiss, and tap-outside-to-dismiss backdrop
 * (spec §7's "no ugly default Alert" ask) — reused by AttachmentSheet, ForwardSheet and
 * MediaSourceSheet instead of each hand-rolling Modal + PanResponder gesture code.
 */
export const AppBottomSheet = forwardRef<BottomSheetModal, AppBottomSheetProps>(function AppBottomSheet(
  { children, snapPoints, dynamicSizing = false, onDismiss, onChange },
  ref,
) {
  const { colors, radius } = useTheme();

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" opacity={0.5} />
    ),
    [],
  );

  const points = useMemo(
    () => (dynamicSizing ? undefined : (snapPoints ?? DEFAULT_SNAP_POINTS)),
    [snapPoints, dynamicSizing],
  );

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={points}
      enableDynamicSizing={!points}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onDismiss={onDismiss}
      onChange={onChange}
      backgroundStyle={{ backgroundColor: colors.surfaceElevated, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl }}
      handleIndicatorStyle={{ backgroundColor: colors.divider, width: 40 }}
    >
      <BottomSheetView style={points ? styles.body : undefined}>{children}</BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  // Only applied for fixed snapPoints sheets — a dynamic-sizing sheet needs
  // its content's intrinsic height to measure itself, so it must NOT get a
  // forced flex:1 here.
  body: { flex: 1 },
});
