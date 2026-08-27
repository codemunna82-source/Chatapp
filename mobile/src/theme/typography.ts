import { Platform } from 'react-native';

const fontFamily = Platform.select({ android: 'sans-serif', default: 'System' });
const fontFamilyMedium = Platform.select({ android: 'sans-serif-medium', default: 'System' });

/**
 * Explicit lineHeight on every variant — the single highest-leverage
 * change for "excellent typography" on a screen full of chat bubbles and
 * list rows, where React Native's unset default (~1.2x, inconsistent
 * across Android OEMs) reads cramped. Headings get slightly negative
 * letterSpacing, a common premium-UI technique for larger type.
 */
export const typography = {
  fontFamily,
  title: { fontSize: 26, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.4, fontFamily: fontFamilyMedium },
  heading: { fontSize: 19, lineHeight: 25, fontWeight: '600' as const, letterSpacing: -0.2, fontFamily: fontFamilyMedium },
  body: { fontSize: 15.5, lineHeight: 22, fontWeight: '400' as const, fontFamily },
  bodyMedium: { fontSize: 15.5, lineHeight: 22, fontWeight: '500' as const, fontFamily: fontFamilyMedium },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const, fontFamily },
  label: { fontSize: 12.5, lineHeight: 16, fontWeight: '600' as const, letterSpacing: 0.2, fontFamily: fontFamilyMedium },
};
