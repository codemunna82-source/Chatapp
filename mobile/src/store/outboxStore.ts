import { create } from 'zustand';
import { getJSON, setJSON } from '../storage/mmkv';
import type { SendMessageBody } from '../api/endpoints/messages';

const OUTBOX_KEY = 'voxo.outbox';
/** A queued send that has been retried this many times without ever reaching the server is dropped to FAILED rather than retried forever. */
export const MAX_OUTBOX_ATTEMPTS = 8;

export interface OutboxItem {
  /** Same id as the optimistic bubble in the message cache, so a flush can replace exactly that row. */
  id: string;
  conversationId: string;
  body: SendMessageBody;
  /** When the user pressed send — not when it was finally delivered. */
  queuedAt: string;
  attempts: number;
}

interface OutboxState {
  items: OutboxItem[];
  enqueue: (item: Omit<OutboxItem, 'attempts'>) => void;
  remove: (id: string) => void;
  recordAttempt: (id: string) => void;
  clear: () => void;
}

function persist(items: OutboxItem[]): void {
  setJSON(OUTBOX_KEY, items);
}

/**
 * Messages the user sent while the phone had no working connection.
 *
 * Persisted to MMKV so closing the app does not lose them — the whole
 * point is that "sent" means sent, even if the send happens twenty minutes
 * later in a lift. `OutboxFlusher` drains this whenever connectivity comes
 * back.
 *
 * Scope, deliberately: text and reactions only. A media send depends on a
 * local file URI that Android reclaims from its cache, plus a separate
 * upload step to Meta — queueing one would promise a delivery the app
 * cannot keep. Media sends that fail offline still show as FAILED with the
 * existing retry, which is honest about what happened.
 *
 * Order is preserved (FIFO) and the flush is sequential: a customer
 * reading three queued messages should read them the way they were typed.
 */
export const useOutboxStore = create<OutboxState>((set, get) => ({
  items: getJSON<OutboxItem[]>(OUTBOX_KEY) ?? [],

  enqueue: (item) => {
    const items = [...get().items, { ...item, attempts: 0 }];
    persist(items);
    set({ items });
  },

  remove: (id) => {
    const items = get().items.filter((i) => i.id !== id);
    persist(items);
    set({ items });
  },

  recordAttempt: (id) => {
    const items = get().items.map((i) => (i.id === id ? { ...i, attempts: i.attempts + 1 } : i));
    persist(items);
    set({ items });
  },

  clear: () => {
    persist([]);
    set({ items: [] });
  },
}));

/** True for the message shapes the outbox will accept — see the store doc for why media is excluded. */
export function isQueueableBody(body: SendMessageBody): boolean {
  return body.type === 'text' || body.type === 'reaction';
}
