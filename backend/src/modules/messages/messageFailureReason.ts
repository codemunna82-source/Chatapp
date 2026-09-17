/**
 * Meta's delivery failure, as a sentence an agent can act on.
 *
 * The raw payload is an array of {code, title, error_data.details}, and
 * none of it is written for the person holding the phone: "Business
 * eligibility payment issue" is Meta telling a developer that the account
 * has no working payment method, and the agent reading it has no idea
 * whether to re-send, wait, or call somebody.
 *
 * So the codes that actually happen get a sentence saying what went wrong
 * and who fixes it. Everything else falls back to Meta's own title, which
 * is at least true, and then to a plain statement that it did not arrive —
 * never to silence, because a message that failed and says nothing is the
 * thing this whole change exists to stop.
 *
 * Kept pure and out of the request path so it can be tested against the
 * shapes Meta actually sends, including the malformed ones.
 */
export function messageFailureReason(errors: unknown): string | undefined {
  const first = firstError(errors);
  if (!first) return undefined;

  switch (first.code) {
    case 131042:
      return 'WhatsApp would not deliver this — the WhatsApp Business account has no working payment method. An admin has to add one in Meta Business Settings.';
    case 132001:
      return 'That approved template does not exist in this language on this number’s WhatsApp Business Account.';
    case 132000:
    case 132005:
    case 132007:
      return 'WhatsApp rejected the template — its wording or its filled-in values do not match what was approved.';
    case 131047:
      return 'More than 24 hours since the customer last wrote, so WhatsApp allows only an approved template until they write again.';
    case 131026:
      return 'WhatsApp could not deliver this — the number may not be on WhatsApp, or cannot receive messages right now.';
    case 131049:
    case 130472:
      return 'WhatsApp held this back to limit marketing messages to this customer. Nothing is wrong with the message.';
    case 131031:
      return 'The WhatsApp Business account is restricted or suspended, so nothing can be sent from it.';
    default:
      return first.title
        ? `WhatsApp did not deliver this: ${first.title}.`
        : 'WhatsApp did not deliver this message.';
  }
}

/**
 * The first entry, defensively.
 *
 * This comes from a webhook body, so the shape is whatever Meta sent —
 * an array, a bare object, or something else entirely after a schema
 * change nobody told us about.
 */
function firstError(errors: unknown): { code?: number; title?: string } | null {
  const entry = Array.isArray(errors) ? errors[0] : errors;
  if (!entry || typeof entry !== 'object') return null;
  const row = entry as Record<string, unknown>;
  return {
    code: typeof row.code === 'number' ? row.code : undefined,
    title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : undefined,
  };
}
