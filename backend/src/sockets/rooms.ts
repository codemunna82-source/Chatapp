/**
 * Canonical Socket.IO room names (spec §22). Always build room names
 * through these helpers rather than string-templating `tenant:${x}`
 * ad hoc, so a typo can't silently create a second, wrong room.
 */
export function tenantRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}

export function userRoom(userId: string): string {
  return `user:${userId}`;
}

export function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

/**
 * Everyone whose visibility is limited to one WhatsApp number.
 *
 * Chat events go to this room *and* the tenant room; a socket in both — it
 * never is, since joinVisibilityRooms picks exactly one — would still be
 * delivered once, because Socket.IO de-duplicates across `.to()` rooms.
 */
export function phoneNumberRoom(whatsappPhoneNumberId: string): string {
  return `number:${whatsappPhoneNumberId}`;
}
