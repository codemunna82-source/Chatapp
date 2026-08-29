import * as Haptics from 'expo-haptics';
import { useAlertPreferenceStore } from '../store/alertPreferenceStore';

/**
 * Thin, fire-and-forget wrappers around expo-haptics.
 *
 * Two deliberate choices:
 *
 * 1. Nothing here is awaited and every call swallows its error. A haptic
 *    is decoration on an action that has already happened — a device with
 *    no vibration motor, or one where the call rejects, must not turn a
 *    successful send into a visible failure.
 * 2. They honour the same `vibrate` switch as incoming-message alerts.
 *    Someone who turned vibration off wants the phone still, and would not
 *    think to look for a second, separate switch for taps.
 *
 * Read straight from the store rather than through a hook so these can be
 * called from event handlers, gesture callbacks and mutation callbacks
 * without dragging a subscription into every component.
 */
function enabled(): boolean {
  return useAlertPreferenceStore.getState().vibrate;
}

function fire(run: () => Promise<void>): void {
  if (!enabled()) return;
  run().catch(() => {
    // A missing or busy vibrator is not worth surfacing.
  });
}

/** Light tick — moving between options, opening a sheet, toggling a row. */
export function selectionFeedback(): void {
  fire(() => Haptics.selectionAsync());
}

/** A committed action: sending a message, confirming a pick. */
export function impactLight(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A longer press that opened something — the message action sheet, multi-select. */
export function impactMedium(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** Something completed — an upload finished, a bulk action applied. */
export function notifySuccess(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Something failed in a way the user has to notice. */
export function notifyError(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
