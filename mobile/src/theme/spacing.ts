export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  full: 999,
} as const;

/**
 * Centralized elevation — never hand-roll shadowColor/shadowOpacity/
 * elevation at a call site. A plain gray shadow reads fine in both light
 * and dark mode (Android's `elevation` does most of the visual work
 * anyway), so these aren't scheme-branched like `colors` is. Used
 * sparingly per the design brief — cards/sheets/the composer bar, not
 * every surface.
 */
export const shadow = {
  none: {},
  sm: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 5,
  },
  lg: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 12,
  },
} as const;

/**
 * Minimum touch-target sizes. Android's own accessibility guidance (and
 * WCAG 2.5.5) put the floor at 48dp / 44dp — every interactive control in
 * this app must have a container at least this big, even when the icon
 * drawn inside it is much smaller.
 *
 * This exists because `hitSlop` alone is NOT a reliable substitute on
 * Android: a touch is dispatched down the view tree, so a child's hitSlop
 * can only expand the area *within* its parent's bounds. In a tightly
 * packed row (the chat composer, a list row's trailing actions) the parent
 * is barely larger than the icon, so most of the hitSlop is clipped away
 * and the control ends up with an effective ~28-34dp target that feels
 * dead when tapped. Size the container instead; use hitSlop only as a
 * small extra margin on top.
 */
export const touchTarget = {
  /** Standalone controls — headers, FABs, list-row actions, the composer. */
  min: 48,
  /** Densely packed rows where 48 would not fit. Still meets WCAG's 44dp. */
  compact: 44,
} as const;
