import type { Message } from '../../api/types';

export interface ReactionSummary {
  IN?: string; // the contact's current reaction emoji, if any
  OUT?: string; // our side's current reaction emoji, if any
}

export interface ConversationView {
  /** Newest-first, matching the API — reaction-type rows are excluded (they're folded into reactionsByTarget instead). */
  renderable: Message[];
  reactionsByTarget: Map<string, ReactionSummary>;
  /** For rendering a quoted snippet above a reply — only messages already loaded in this page set are found. */
  messageById: Map<string, Message>;
}

/**
 * Splits the flat, paginated message list into what actually renders as a
 * bubble vs. what annotates one (spec §19: reply, reactions). A reaction is
 * itself a Message row (type 'reaction', replyToMessageId = its target) —
 * see backend message.service.ts/webhook.service.ts — so this is where
 * that gets folded back into "the last reaction per side, per target".
 */
export function deriveConversationView(messages: Message[]): ConversationView {
  const messageById = new Map<string, Message>();
  for (const m of messages) messageById.set(m.id, m);

  const latestReactionAt = new Map<string, string>(); // `${targetId}:${direction}` -> createdAt, to keep only the latest
  const reactionsByTarget = new Map<string, ReactionSummary>();
  const renderable: Message[] = [];

  for (const m of messages) {
    if (m.type === 'reaction' && m.replyToMessageId) {
      const key = `${m.replyToMessageId}:${m.direction}`;
      const prevAt = latestReactionAt.get(key);
      if (!prevAt || m.createdAt > prevAt) {
        latestReactionAt.set(key, m.createdAt);
        const summary = reactionsByTarget.get(m.replyToMessageId) ?? {};
        summary[m.direction] = m.text; // '' means "removed" — filtered out at render time
        reactionsByTarget.set(m.replyToMessageId, summary);
      }
      continue;
    }
    renderable.push(m);
  }

  return { renderable, reactionsByTarget, messageById };
}
