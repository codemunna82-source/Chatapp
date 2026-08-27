/**
 * Seam for real-time push, implemented for real in Phase 4 (Socket.IO +
 * Redis adapter, per architecture doc §5). Kept as a no-op here so Phase 3's
 * webhook/message pipelines can call it now without depending on Socket.IO
 * internals — swap `realtimeEmitter` for the Socket.IO-backed implementation
 * when that phase lands; nothing calling this file needs to change.
 */
export interface RealtimeEmitter {
  emitMessageNew(tenantId: string, conversationId: string, messageId: string): void;
  emitMessageStatus(tenantId: string, conversationId: string, messageId: string, status: string): void;
  emitConversationUpdated(tenantId: string, conversationId: string): void;
}

const noopEmitter: RealtimeEmitter = {
  emitMessageNew: () => {},
  emitMessageStatus: () => {},
  emitConversationUpdated: () => {},
};

let current: RealtimeEmitter = noopEmitter;

export function getRealtimeEmitter(): RealtimeEmitter {
  return current;
}

/** Called once by the Phase 4 Socket.IO gateway at startup to replace the no-op. */
export function setRealtimeEmitter(emitter: RealtimeEmitter): void {
  current = emitter;
}
