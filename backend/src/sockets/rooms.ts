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

/**
 * Every signed-in agent socket of a workspace, regardless of which
 * visibility room it landed in.
 *
 * Presence has to be counted somewhere, and the visibility rooms cannot do
 * it: an agent is in exactly one of the tenant room or their number room,
 * so answering "is anyone here" would mean counting both and knowing every
 * number the workspace has. One room every agent joins makes it a single
 * lookup that cannot drift as assignments change.
 */
export function agentsRoom(tenantId: string): string {
  return `agents:${tenantId}`;
}

/**
 * The customers watching a workspace's availability.
 *
 * Guests are never in the agent or tenant rooms — those carry the whole
 * workspace's messages — so presence is pushed to this separate room that
 * holds nothing but the presence event itself.
 */
export function guestPresenceRoom(tenantId: string): string {
  return `presence:${tenantId}`;
}
