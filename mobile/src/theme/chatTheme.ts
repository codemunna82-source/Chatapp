import type { ColorTokens } from './colors';

/**
 * A fixed color pair for the conversation screen — matches a specific
 * navy + gold reference design the user asked to replicate (light and dark
 * variants), independent of the app's own accent color everywhere else.
 * Unlike the earlier crimson version of this override, this ONE now
 * genuinely follows the app's light/dark/system preference: whichever of
 * these two palettes matches the resolved scheme is picked by the caller
 * (see useResolvedScheme() in ThemeProvider.tsx) and passed into a nested
 * <ThemeProvider colors={...}> around just the ConversationDetailScreen
 * subtree — Settings still controls every other screen normally.
 */
export const chatLightColors: ColorTokens = {
  background: '#EDE4D3',
  surface: '#EDE4D3',
  surfaceAlt: '#E3D7C0',
  surfaceElevated: '#F5EEE1',
  border: '#C9A15B',
  divider: '#D9CBAE',
  textPrimary: '#1F3A47',
  textSecondary: '#5B6B72',
  textTertiary: '#8A9499',
  textOnPrimary: '#F5EEDC',
  primary: '#1F3A47',
  primaryMuted: '#D9E2E5',
  success: '#1B9E5A',
  successMuted: '#E4F7ED',
  warning: '#B8760F',
  warningMuted: '#FBF0DD',
  danger: '#D3403F',
  dangerMuted: '#FBE7E7',
  overlay: 'rgba(31, 58, 71, 0.48)',
  // Outgoing keeps the deep navy; incoming is a lighter, warmer surface so
  // the two sides are distinguishable at a glance. They were previously the
  // same value, which made every bubble look identical apart from its
  // alignment.
  bubbleSent: '#1F3A47',
  bubbleSentText: '#F5EEDC',
  bubbleReceived: '#F7F1E3',
  bubbleReceivedText: '#22323B',
};

export const chatDarkColors: ColorTokens = {
  background: '#121316',
  surface: '#121316',
  surfaceAlt: '#1B1D21',
  surfaceElevated: '#1B2830',
  border: '#C9A15B',
  divider: '#2A2D33',
  textPrimary: '#F5EEDC',
  textSecondary: '#B8AF9C',
  textTertiary: '#8A8578',
  textOnPrimary: '#F5EEDC',
  primary: '#C9A15B',
  primaryMuted: '#3A3020',
  success: '#3FCB7C',
  successMuted: '#193A29',
  warning: '#E0A83E',
  warningMuted: '#3B2E12',
  danger: '#E9706F',
  dangerMuted: '#3C1F1F',
  overlay: 'rgba(0, 0, 0, 0.68)',
  // Same split in dark: navy out, a raised charcoal in.
  bubbleSent: '#1F3A47',
  bubbleSentText: '#F5EEDC',
  bubbleReceived: '#23262B',
  bubbleReceivedText: '#ECE6D8',
};

/**
 * The header's own solid navy background — deliberately not part of
 * ColorTokens and deliberately the SAME in both light and dark (matches
 * both reference images identically; every other screen keeps its normal
 * theme-driven header).
 */
export const chatHeaderBackground = '#16303D';
