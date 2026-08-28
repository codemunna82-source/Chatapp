import React, { createContext, useContext, useMemo } from 'react';
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
 * The light/dark scheme currently in effect. Exported so a screen that
 * overrides `colors` (see above) can still pick the right variant of ITS
 * OWN palette — a themed screen should follow the Settings toggle like
 * every other screen, it just uses a different palette while doing so.
 */
export function useResolvedScheme(): 'light' | 'dark' {
  // The preference is now always an explicit 'light' or 'dark' — the
  // follow-the-system option was removed from Settings, and the store
  // migrates any previously-stored 'system' value on first read.
  return useThemePreferenceStore((s) => s.preference);
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
