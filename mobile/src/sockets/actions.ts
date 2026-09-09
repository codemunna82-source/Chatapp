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

/* ------------------------------------------------------------------ *
 * Calls with the customer's web chat window.                          *
 *                                                                     *
 * Every name here is prefixed `web:`, and that separation is           *
 * load-bearing rather than tidiness: a WhatsApp call is answered by    *
 * posting an SDP back to Meta, and crossing the two would hand a       *
 * browser's offer to Meta's API.                                       *
 * ------------------------------------------------------------------ */

export function emitWebCallAnswer(callId: string, sdp: string): void {
  getSocket().emit('web:call:answer', { callId, sdp });
}

export function emitWebCallIce(callId: string, candidate: unknown): void {
  getSocket().emit('web:call:ice', { callId, candidate });
}

export function emitWebCallReject(callId: string): void {
  getSocket().emit('web:call:reject', { callId });
}

export function emitWebCallEnd(callId: string): void {
  getSocket().emit('web:call:end', { callId });
}
