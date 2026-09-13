import type { ColorTokens } from './colors';

/**
 * The conversation screen's own palette — WhatsApp's, in both schemes.
 *
 * These are WhatsApp's actual values rather than an approximation of
 * them, and they are the SAME ones the customer's web chat window already
 * uses (see the frontend's globals.css --wa-* tokens). That matters for
 * more than tidiness: the agent and the customer are looking at two
 * halves of one conversation, and two different greens would make them
 * look like two different products.
 *
 * Applied through a nested <ThemeProvider colors={...}> around just the
 * ConversationDetailScreen subtree, picked by useResolvedScheme() — so it
 * still follows the app's light/dark/system setting, and every other
 * screen keeps the app's own accent.
 *
 * The previous navy-and-gold pair was a reference design from earlier in
 * the project's life. It is replaced, not adjusted: a chat screen that
 * looks almost-but-not-quite like the messenger it mirrors reads as a
 * cheap imitation, where one that matches reads as the same thing.
 */
export const chatLightColors: ColorTokens = {
  // The wallpaper ground. ChatWallpaper draws its doodles over this.
  background: '#EFE7DE',
  surface: '#F7F5F3',
  surfaceAlt: '#FFFFFF',
  // The composer bar sits on this — near-white, as WhatsApp's does.
  surfaceElevated: '#F7F5F3',
  border: '#E9EDEF',
  divider: '#E9EDEF',
  textPrimary: '#111B21',
  textSecondary: '#667781',
  textTertiary: '#8696A0',
  textOnPrimary: '#FFFFFF',
  // WhatsApp's teal-green: the send button, links, the reply bar's stripe.
  primary: '#00A884',
  primaryMuted: '#D9FDD3',
  success: '#0A9D57',
  successMuted: '#D9FDD3',
  warning: '#B8760F',
  warningMuted: '#FFF3D6',
  danger: '#EA0038',
  dangerMuted: '#FDE7EB',
  overlay: 'rgba(11, 20, 26, 0.44)',
  // The two bubble colours everyone recognises: pale green out, white in.
  bubbleSent: '#D9FDD3',
  bubbleSentText: '#111B21',
  bubbleReceived: '#FFFFFF',
  bubbleReceivedText: '#111B21',
};

export const chatDarkColors: ColorTokens = {
  background: '#0B141A',
  surface: '#111B21',
  surfaceAlt: '#202C33',
  surfaceElevated: '#1F2C34',
  border: '#222E35',
  divider: '#222E35',
  textPrimary: '#E9EDEF',
  textSecondary: 'rgba(233, 237, 239, 0.6)',
  textTertiary: '#8696A0',
  textOnPrimary: '#FFFFFF',
  primary: '#00A884',
  primaryMuted: '#005C4B',
  success: '#25D366',
  successMuted: '#005C4B',
  warning: '#F0B84B',
  warningMuted: '#3B2E12',
  danger: '#F15C6D',
  dangerMuted: '#3C1F1F',
  overlay: 'rgba(0, 0, 0, 0.68)',
  bubbleSent: '#005C4B',
  bubbleSentText: '#E9EDEF',
  bubbleReceived: '#202C33',
  bubbleReceivedText: '#E9EDEF',
};

/**
 * The conversation header's background.
 *
 * No longer one fixed colour for both schemes. WhatsApp's header is part
 * of the chrome, not a band of brand colour sitting on top of it — a
 * near-white strip in light, the raised charcoal in dark — and a single
 * navy bar across both was the loudest thing on the screen in either.
 */
export const chatHeaderBackground = { light: '#F7F5F3', dark: '#1F2C34' } as const;

/** Header text and icons, against the backgrounds above. */
export const chatHeaderForeground = { light: '#111B21', dark: '#E9EDEF' } as const;
