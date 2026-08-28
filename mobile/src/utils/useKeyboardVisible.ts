import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * Whether the on-screen keyboard is currently showing.
 *
 * Needed because this app runs edge-to-edge (android/gradle.properties'
 * `edgeToEdgeEnabled=true`, targetSdk 36). Under edge-to-edge Android stops
 * honouring `windowSoftInputMode="adjustResize"` — the window no longer
 * shrinks when the IME opens, and the keyboard is delivered as a window
 * inset instead. A screen therefore has to move its own bottom bar, and it
 * must also drop the navigation-bar safe-area padding while the keyboard is
 * up, or that inset stacks on top of the keyboard as a dead gap.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // didShow/didHide (not willShow/willHide): the "will" variants are
    // iOS-only, and this app is Android-only.
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return visible;
}
