import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { lightColors, darkColors, type ColorTokens } from './colors';
import { spacing, radius, shadow, touchTarget } from './spacing';
import { typography } from './typography';
import { useThemePreferenceStore } from '../store/themePreferenceStore';

export interface Theme {
  scheme: 'light' | 'dark';
  colors: ColorTokens;
  spacing: typeof spacing;
  radius: typeof radius;
  shadow: typeof shadow;
  touchTarget: typeof touchTarget;
  typography: typeof typography;
}

const ThemeContext = createContext<Theme | null>(null);

interface ThemeProviderProps {
  children: React.ReactNode;
  /**
   * Overrides the resolved color tokens for this subtree only — everything
   * outside a nested provider still reads the normal preference-driven
   * theme unaffected. Used to give one screen (e.g. the conversation
   * screen) its own fixed brand palette. The override itself is expected
   * to already match the ambient light/dark scheme (pick it with
   * useResolvedScheme() before rendering the nested provider) — see
   * chatTheme.ts and ConversationDetailScreen.tsx.
   */
  colors?: ColorTokens;
}

/**
 * Resolves 'system' | 'light' | 'dark' down to the actual 'light' | 'dark'
 * scheme currently in effect, the same logic ThemeProvider itself uses.
 * Exported so a screen that overrides `colors` (see above) can still pick
 * the right light/dark variant of ITS OWN palette to match — a themed
 * screen should follow Settings' light/dark/system toggle same as every
 * other screen, it just uses a different palette while doing so.
 */
export function useResolvedScheme(): 'light' | 'dark' {
  const systemScheme = useColorScheme();
  const preference = useThemePreferenceStore((s) => s.preference);
  // 'system' (the default) follows the OS setting, same as before this
  // store existed; 'light'/'dark' is an explicit user override from Settings.
  return preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;
}

export function ThemeProvider({ children, colors: colorsOverride }: ThemeProviderProps) {
  const scheme = useResolvedScheme();

  const theme = useMemo<Theme>(
    () => ({
      scheme,
      colors: colorsOverride ?? (scheme === 'dark' ? darkColors : lightColors),
      spacing,
      radius,
      shadow,
      touchTarget,
      typography,
    }),
    [scheme, colorsOverride],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme() must be called inside <ThemeProvider>');
  }
  return theme;
}
