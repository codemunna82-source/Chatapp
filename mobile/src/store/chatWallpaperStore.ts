import { create } from 'zustand';
import { getJSON, setJSON } from '../storage/mmkv';

/**
 * Deliberately a small fixed set rather than "pick any image". A
 * user-supplied photo behind a chat has to be dimmed, blurred and
 * re-tinted per theme to keep message text readable, and gets that wrong
 * often enough that WhatsApp itself ships a curated set for the same
 * reason. These four are all drawn from the theme's own tokens, so each
 * one stays legible in both light and dark automatically.
 */
export const WALLPAPER_STYLES = ['doodles', 'plain', 'dots', 'grid'] as const;
export type WallpaperStyle = (typeof WALLPAPER_STYLES)[number];

export const WALLPAPER_LABELS: Record<WallpaperStyle, string> = {
  doodles: 'Doodles',
  plain: 'Plain',
  dots: 'Dots',
  grid: 'Grid',
};

const WALLPAPER_KEY = 'voxo.chatWallpaper';

function initialStyle(): WallpaperStyle {
  const stored = getJSON<string>(WALLPAPER_KEY);
  return WALLPAPER_STYLES.includes(stored as WallpaperStyle) ? (stored as WallpaperStyle) : 'doodles';
}

interface ChatWallpaperState {
  style: WallpaperStyle;
  setStyle: (style: WallpaperStyle) => void;
}

/** Per-device, like the theme preference — not a tenant setting, since it
 *  is a personal display choice and every agent can want a different one. */
export const useChatWallpaperStore = create<ChatWallpaperState>((set) => ({
  style: initialStyle(),
  setStyle: (style) => {
    setJSON(WALLPAPER_KEY, style);
    set({ style });
  },
}));
