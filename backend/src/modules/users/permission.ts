/**
 * Fine-grained permissions assignable to SUB_USER accounts (spec §9).
 * MASTER_ADMIN implicitly has all of these within their own tenant and does
 * not need them listed on the user document.
 */
export const PERMISSIONS = [
  'CHAT_READ',
  'CHAT_SEND',
  'CHAT_MEDIA',
  'CHAT_TEMPLATE',
  'CHAT_REACTION',
  'CHAT_PIN',
  'CALL_ACCESS',
  'CALL_HISTORY',
  'ANALYTICS_VIEW',
  'PROFILE_VIEW',
  'PROFILE_EDIT',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}
