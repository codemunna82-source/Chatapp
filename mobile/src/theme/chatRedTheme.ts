import type { ColorTokens } from './colors';

/**
 * A fixed, always-on color set for the conversation screen — matches a
 * specific dark + crimson reference design the user asked to replicate
 * exactly, independent of the app's own light/dark/system preference
 * (Settings still controls every other screen normally). Applied via a
 * nested <ThemeProvider colors={chatRedColors}> around just the
 * ConversationDetailScreen subtree — see ThemeProvider.tsx.
 */
export const chatRedColors: ColorTokens = {
  background: '#0A0A0D',
  surface: '#0A0A0D',
  surfaceAlt: '#1C1C22',
  surfaceElevated: '#141418',
  border: '#2A2A32',
  divider: '#242430',
  textPrimary: '#FFFFFF',
  textSecondary: '#B4B4BE',
  textTertiary: '#7C7C88',
  textOnPrimary: '#FFFFFF',
  primary: '#E53935',
  primaryMuted: '#3A1414',
  success: '#43A047',
  successMuted: '#173A1B',
  warning: '#FFB300',
  warningMuted: '#3A2E12',
  danger: '#EF5350',
  dangerMuted: '#3A1414',
  overlay: 'rgba(0, 0, 0, 0.72)',
  bubbleSent: '#D32F2F',
  bubbleSentText: '#FFFFFF',
  bubbleReceived: '#1C1C22',
  bubbleReceivedText: '#F0F0F4',
};

/** The header's own solid red background — deliberately not part of ColorTokens (every other screen keeps its normal header). */
export const chatHeaderBackground = '#B71C1C';
