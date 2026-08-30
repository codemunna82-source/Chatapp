import type { MessageType } from '../../modules/messages/message.model';

const KNOWN_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'text',
  'image',
  'video',
  'audio',
  'document',
  'location',
  'contacts',
  'reaction',
  'interactive',
  'sticker',
]);

export interface NormalizedMessageItem {
  kind: 'message';
  eventId: string; // = the wamid — globally unique per message
  phoneNumberId: string;
  from: string;
  messageId: string;
  messageType: MessageType;
  text?: string;
  mediaRef?: { metaMediaId: string; mimeType?: string };
  contactName?: string;
  timestamp: Date;
  raw: unknown;
}

export interface NormalizedStatusItem {
  kind: 'status';
  eventId: string; // = `${messageId}:${status}` — unique per status transition
  phoneNumberId: string;
  messageId: string;
  status: string; // Meta's raw status string: sent | delivered | read | failed | ...
  timestamp: Date;
  errors?: unknown;
  raw: unknown;
}

/**
 * An inbound voice call, or the end of one.
 *
 * Calls arrive through the same webhook as messages — same
 * `entry[].changes[]` envelope, same `metadata.phone_number_id` — under
 * `field: "calls"` instead of `"messages"`. That means signature checking,
 * idempotency and tenant resolution all already apply to them unchanged.
 */
export interface NormalizedCallItem {
  kind: 'call';
  /** `${callId}:${event}` — one call produces a connect and a terminate. */
  eventId: string;
  phoneNumberId: string;
  callId: string;
  event: 'connect' | 'terminate';
  from: string;
  contactName?: string;
  /** Meta's WebRTC offer. Present on connect; this is what the device answers. */
  sdpOffer?: string;
  /** Present on terminate: how the call ended, and how long it lasted. */
  status?: string;
  durationSeconds?: number;
  timestamp: Date;
  raw: unknown;
}

export type NormalizedWebhookItem = NormalizedMessageItem | NormalizedStatusItem | NormalizedCallItem;

function toMessageType(raw: string): MessageType {
  return (KNOWN_MESSAGE_TYPES.has(raw) ? raw : 'unknown') as MessageType;
}

function toDate(unixSeconds: unknown): Date {
  const n = Number(unixSeconds);
  return Number.isFinite(n) ? new Date(n * 1000) : new Date();
}

// Meta payloads are typed as `any`-shaped JSON from an external system —
// we validate defensively rather than trusting a strict interface here.
/* eslint-disable @typescript-eslint/no-explicit-any */
function extractText(type: string, node: any): string | undefined {
  switch (type) {
    case 'text':
      return node?.text?.body;
    case 'image':
      return node?.image?.caption;
    case 'video':
      return node?.video?.caption;
    case 'document':
      return node?.document?.caption ?? node?.document?.filename;
    case 'location':
      return node?.location
        ? `${node.location.name ?? 'Location'} (${node.location.latitude}, ${node.location.longitude})`
        : undefined;
    case 'contacts':
      return node?.contacts?.[0]?.name?.formatted_name;
    case 'reaction':
      return node?.reaction?.emoji;
    default:
      return undefined;
  }
}

function extractMediaRef(type: string, node: any): { metaMediaId: string; mimeType?: string } | undefined {
  const mediaNode = node?.[type];
  if (mediaNode?.id) {
    return { metaMediaId: mediaNode.id, mimeType: mediaNode.mime_type };
  }
  return undefined;
}

/**
 * Flattens Meta's nested `entry[].changes[].value` webhook envelope into a
 * flat list of individually idempotency-keyed items. One HTTP delivery can
 * legitimately contain multiple entries/changes and multiple messages and
 * statuses within a single change (spec §16) — this is why idempotency is
 * tracked per-item, not per-HTTP-request.
 */
export function parseWebhookPayload(rawPayload: any): NormalizedWebhookItem[] {
  const items: NormalizedWebhookItem[] = [];
  const entries = Array.isArray(rawPayload?.entry) ? rawPayload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      if (!value) continue;

      const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      if (change?.field === 'calls') {
        const contactName: string | undefined = value?.contacts?.[0]?.profile?.name;
        const calls = Array.isArray(value.calls) ? value.calls : [];
        for (const c of calls) {
          if (!c?.id) continue;
          // Meta names the two shapes by what they carry, not by a type
          // field: a connect carries the SDP offer to answer, a terminate
          // carries the outcome. Reading the shape avoids depending on a
          // discriminator that is not documented to exist.
          const isConnect = Boolean(c?.session?.sdp);
          items.push({
            kind: 'call',
            eventId: `${c.id}:${isConnect ? 'connect' : 'terminate'}`,
            phoneNumberId,
            callId: c.id,
            event: isConnect ? 'connect' : 'terminate',
            from: c.from ?? '',
            contactName,
            sdpOffer: c?.session?.sdp,
            status: c?.status,
            durationSeconds: typeof c?.duration === 'number' ? c.duration : undefined,
            timestamp: toDate(c.timestamp),
            raw: c,
          });
        }
        continue;
      }

      if (change?.field !== 'messages') continue;

      const contactName: string | undefined = value?.contacts?.[0]?.profile?.name;

      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const m of messages) {
        if (!m?.id || !m?.from) continue;
        const messageType = toMessageType(m.type);
        items.push({
          kind: 'message',
          eventId: m.id,
          phoneNumberId,
          from: m.from,
          messageId: m.id,
          messageType,
          text: extractText(m.type, m),
          mediaRef: extractMediaRef(m.type, m),
          contactName,
          timestamp: toDate(m.timestamp),
          raw: m,
        });
      }

      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      for (const s of statuses) {
        if (!s?.id || !s?.status) continue;
        items.push({
          kind: 'status',
          eventId: `${s.id}:${s.status}`,
          phoneNumberId,
          messageId: s.id,
          status: s.status,
          timestamp: toDate(s.timestamp),
          errors: s.errors,
          raw: s,
        });
      }
    }
  }

  return items;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
