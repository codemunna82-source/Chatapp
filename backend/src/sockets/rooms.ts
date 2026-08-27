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
