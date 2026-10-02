/**
 * Meta's health_status, reduced to the two things worth storing.
 *
 * The raw structure answers for four entities at once — the number, its
 * WhatsApp Business Account, the owning business and the app — and each
 * may carry errors, additional_info, or nothing. Most of it is noise on
 * any given day; what an operator needs is whether this number can send,
 * and if not, the sentence that says why.
 *
 * Written as a pure function over the raw shape rather than a typed
 * parser, because Meta adds entity kinds and error codes here without
 * notice and the one that matters is usually the one not seen before.
 */

export interface HealthStatusSummary {
  /** Meta's verdict: AVAILABLE, LIMITED, BLOCKED, … or undefined if absent. */
  canSendMessage?: string;
  /** The reason, in Meta's own words, when sending is not fully available. */
  reason?: string;
}

/**
 * Calling errors are not sending errors.
 *
 * A number with no SIP server configured reports 138024/138025 against
 * `can_receive_call_sip`, and it sits in the same `errors` array as
 * anything blocking messages. Reporting "cannot use SIP" to someone whose
 * messages are not arriving sends them to configure a telephony feature
 * they are not using, which is worse than saying nothing.
 */
function isAboutCalling(description: string): boolean {
  return /\bSIP\b|calling/i.test(description);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The sentence Meta gives for one entity, preferring the plainest one. */
function reasonFor(entity: Record<string, unknown>): string | undefined {
  // additional_info first: it is the human sentence Meta writes for the
  // operator ("Your display name has not been approved yet"), while
  // errors[] is written for whoever is calling the API.
  const info = Array.isArray(entity.additional_info) ? entity.additional_info : [];
  for (const line of info) {
    if (typeof line === 'string' && line.trim() && !isAboutCalling(line)) return line.trim();
  }

  const errors = Array.isArray(entity.errors) ? entity.errors : [];
  for (const raw of errors) {
    const error = asRecord(raw);
    const description = typeof error?.error_description === 'string' ? error.error_description : '';
    if (!description || isAboutCalling(description)) continue;
    const solution = typeof error?.possible_solution === 'string' ? error.possible_solution : '';
    return solution ? `${description} ${solution}` : description;
  }

  return undefined;
}

export function summariseHealthStatus(raw: unknown): HealthStatusSummary {
  const root = asRecord(raw);
  if (!root) return {};

  const canSendMessage = typeof root.can_send_message === 'string' ? root.can_send_message : undefined;
  if (canSendMessage === 'AVAILABLE') return { canSendMessage };

  const entities = Array.isArray(root.entities) ? root.entities : [];

  // The entity actually holding things up, not the first one listed. A
  // number held at a limit sits in a list where the account, the business
  // and the app all read AVAILABLE, and taking the first entry would
  // report the healthy one.
  for (const candidate of entities) {
    const entity = asRecord(candidate);
    if (!entity) continue;
    const verdict = typeof entity.can_send_message === 'string' ? entity.can_send_message : undefined;
    if (!verdict || verdict === 'AVAILABLE') continue;
    const reason = reasonFor(entity);
    if (reason) return { canSendMessage: canSendMessage ?? verdict, reason };
  }

  return { canSendMessage };
}
