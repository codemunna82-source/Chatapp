import { create } from 'zustand';
import { getJSON, setJSON } from '../storage/mmkv';

/**
 * The four built-in patterns, all drawn from the theme's own tokens, so
 * each stays legible in both light and dark automatically.
 *
 * A fifth option, 'custom', renders a photo the user picked. That one
 * cannot be legible by construction — a bright or busy photo behind dark
 * text is unreadable — so it is drawn under a scrim (see ChatWallpaper),
 * which is the same thing WhatsApp does and the reason it ships a curated
 * set alongside.
 */
export const WALLPAPER_STYLES = ['doodles', 'plain', 'dots', 'grid', 'custom'] as const;
export type WallpaperStyle = (typeof WALLPAPER_STYLES)[number];

export const WALLPAPER_LABELS: Record<WallpaperStyle, string> = {
  doodles: 'Doodles',
  plain: 'Plain',
  dots: 'Dots',
  grid: 'Grid',
  custom: 'Photo',
};

/** How much the scrim dims a custom photo, so message text stays readable
 *  over whatever was picked. Exposed so Settings can preview honestly. */
export const CUSTOM_WALLPAPER_DIM = 0.45;

const WALLPAPER_KEY = 'voxo.chatWallpaper';
const WALLPAPER_URI_KEY = 'voxo.chatWallpaperUri';

function initialStyle(): WallpaperStyle {
  const stored = getJSON<string>(WALLPAPER_KEY);
  if (!WALLPAPER_STYLES.includes(stored as WallpaperStyle)) return 'doodles';
  // 'custom' without a stored file is a dead state — the file can be gone
  // (app data cleared, a restore onto a new device) while the preference
  // survives, which would leave the chat with no background at all.
  if (stored === 'custom' && !getJSON<string>(WALLPAPER_URI_KEY)) return 'doodles';
  return stored as WallpaperStyle;
}

interface ChatWallpaperState {
  style: WallpaperStyle;
  /** Local file URI of the picked photo, when style is 'custom'. */
  customUri: string | null;
  setStyle: (style: WallpaperStyle) => void;
  /** Switches to the custom photo and remembers where it was copied to. */
  setCustomWallpaper: (uri: string) => void;
}

/** Per-device, like the theme preference — not a tenant setting, since it
 *  is a personal display choice and every agent can want a different one. */
export const useChatWallpaperStore = create<ChatWallpaperState>((set) => ({
  style: initialStyle(),
  customUri: getJSON<string>(WALLPAPER_URI_KEY) ?? null,
  setStyle: (style) => {
    setJSON(WALLPAPER_KEY, style);
    set({ style });
  },
  setCustomWallpaper: (uri) => {
    setJSON(WALLPAPER_URI_KEY, uri);
    setJSON(WALLPAPER_KEY, 'custom');
    set({ style: 'custom', customUri: uri });
  },
}));
