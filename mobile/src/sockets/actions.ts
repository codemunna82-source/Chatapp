import { getSocket } from './socketClient';

export function emitTypingStart(conversationId: string): void {
  getSocket().emit('typing:start', { conversationId });
}

export function emitTypingStop(conversationId: string): void {
  getSocket().emit('typing:stop', { conversationId });
}

export function emitConversationRead(conversationId: string): void {
  getSocket().emit('conversation:read', { conversationId });
}
