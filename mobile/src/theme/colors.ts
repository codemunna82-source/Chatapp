/**
 * VOXO brand color is a deep indigo (#4C3FE0) — deliberately distinct from
 * WhatsApp's green (spec §45: no WhatsApp branding). One accent color only;
 * every other token is a neutral (gray/white/black-derived) tone so the
 * accent stays the single thing that draws the eye — success/warning/danger
 * are semantic, not decorative, and used sparingly (status pills, banners).
 */
export interface ColorTokens {
  background: string;
  surface: string;
  surfaceAlt: string;
  /** Card/sheet backgrounds that sit visually "above" the screen — paired with the `shadow` tokens in spacing.ts. */
  surfaceElevated: string;
  border: string;
  /** A second, quieter border for internal dividers (list row separators) vs. `border`'s outer/input-field use. */
  divider: string;
  textPrimary: string;
  textSecondary: string;
  /** Low-emphasis text — timestamps, helper captions. One step quieter than textSecondary. */
  textTertiary: string;
  textOnPrimary: string;
  primary: string;
  primaryMuted: string;
  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  danger: string;
  dangerMuted: string;
  overlay: string;
  /** Outgoing ("sent") message bubble fill — distinct from `primary` so bubbles don't compete visually with buttons/links. */
  bubbleSent: string;
  bubbleSentText: string;
  /** Incoming ("received") message bubble fill. */
  bubbleReceived: string;
  bubbleReceivedText: string;
}

export const lightColors: ColorTokens = {
  background: '#FFFFFF',
  surface: '#F7F7FB',
  surfaceAlt: '#EFEFF6',
  surfaceElevated: '#FFFFFF',
  border: '#E4E4EE',
  divider: '#EEEEF4',
  textPrimary: '#15151F',
  textSecondary: '#68687E',
  textTertiary: '#9494A8',
  textOnPrimary: '#FFFFFF',
  primary: '#4C3FE0',
  primaryMuted: '#EEEBFC',
  success: '#1B9E5A',
  successMuted: '#E4F7ED',
  warning: '#B8760F',
  warningMuted: '#FBF0DD',
  danger: '#D3403F',
  dangerMuted: '#FBE7E7',
  overlay: 'rgba(12, 12, 24, 0.48)',
  bubbleSent: '#4C3FE0',
  bubbleSentText: '#FFFFFF',
  bubbleReceived: '#F1F1F8',
  bubbleReceivedText: '#15151F',
};

export const darkColors: ColorTokens = {
  background: '#0F0F16',
  surface: '#17171F',
  surfaceAlt: '#1F1F2A',
  surfaceElevated: '#1C1C26',
  border: '#2C2C3A',
  divider: '#242430',
  textPrimary: '#F3F3FA',
  textSecondary: '#A3A3B8',
  textTertiary: '#75758C',
  textOnPrimary: '#FFFFFF',
  primary: '#8A7FFF',
  primaryMuted: '#28234F',
  success: '#3FCB7C',
  successMuted: '#193A29',
  warning: '#E0A83E',
  warningMuted: '#3B2E12',
  danger: '#E9706F',
  dangerMuted: '#3C1F1F',
  overlay: 'rgba(0, 0, 0, 0.6)',
  bubbleSent: '#4C3FE0',
  bubbleSentText: '#FFFFFF',
  bubbleReceived: '#232330',
  bubbleReceivedText: '#F3F3FA',
};
