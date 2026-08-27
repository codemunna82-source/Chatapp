import { Platform } from 'react-native';

const fontFamily = Platform.select({ android: 'sans-serif', default: 'System' });

export const typography = {
  fontFamily,
  title: { fontSize: 24, fontWeight: '700' as const, fontFamily },
  heading: { fontSize: 18, fontWeight: '600' as const, fontFamily },
  body: { fontSize: 15, fontWeight: '400' as const, fontFamily },
  bodyMedium: { fontSize: 15, fontWeight: '500' as const, fontFamily },
  caption: { fontSize: 13, fontWeight: '400' as const, fontFamily },
  label: { fontSize: 13, fontWeight: '600' as const, fontFamily },
};
