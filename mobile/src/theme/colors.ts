/**
 * VOXO brand color is a deep indigo (#4C3FE0) — deliberately distinct from
 * WhatsApp's green (spec §45: no WhatsApp branding).
 */
export interface ColorTokens {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textOnPrimary: string;
  primary: string;
  primaryMuted: string;
  success: string;
  warning: string;
  danger: string;
  overlay: string;
}

export const lightColors: ColorTokens = {
  background: '#FFFFFF',
  surface: '#F5F5FA',
  surfaceAlt: '#EBEBF5',
  border: '#DFDFEA',
  textPrimary: '#1A1A2E',
  textSecondary: '#6B6B80',
  textOnPrimary: '#FFFFFF',
  primary: '#4C3FE0',
  primaryMuted: '#E7E4FB',
  success: '#1FAA59',
  warning: '#C9861A',
  danger: '#D64545',
  overlay: 'rgba(15, 15, 30, 0.5)',
};

export const darkColors: ColorTokens = {
  background: '#121218',
  surface: '#1C1C26',
  surfaceAlt: '#26263355',
  border: '#33334A',
  textPrimary: '#F2F2FA',
  textSecondary: '#A0A0B8',
  textOnPrimary: '#FFFFFF',
  primary: '#8A7FFF',
  primaryMuted: '#2C2760',
  success: '#3FCB7C',
  warning: '#E0A83E',
  danger: '#E9706F',
  overlay: 'rgba(0, 0, 0, 0.6)',
};
