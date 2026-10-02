/**
 * Whether a number or a Business Manager can be removed, and what to say
 * when it cannot.
 *
 * Pure, and separate from the services that act on them, because the
 * refusals ARE the feature. Each one stands between an admin and a state
 * that looks fine and quietly does not work — a Business Manager deleted
 * out from under the numbers that send on its credentials, or a number
 * deleted out from under the customer chats that point at it. A rule that
 * important is worth pinning in a test that needs no database.
 */

export interface RemovalBlock {
  code: string;
  message: string;
}

/**
 * Why this number cannot be removed, or null when it can.
 *
 * A Conversation's whatsappPhoneNumberId is a required field, so removing
 * the number it points at does not tidy anything up — it leaves the thread
 * pointing at a row that is gone. There is no silent version of that, so
 * the refusal names the count and points at the switch that does what the
 * admin usually means: off locks every member out and keeps the chats.
 */
export function blockNumberRemoval(input: {
  displayPhoneNumber: string;
  conversationCount: number;
}): RemovalBlock | null {
  if (input.conversationCount <= 0) return null;
  const chats = `${input.conversationCount} customer chat${input.conversationCount === 1 ? '' : 's'}`;
  return {
    code: 'WHATSAPP_NUMBER_HAS_HISTORY',
    message:
      `${input.displayPhoneNumber} has ${chats} on it, which would be left unreadable if the number were ` +
      'removed. Switch the number off instead — that locks every member out of it and keeps the chats.',
  };
}

/**
 * Why this Business Manager cannot be removed, or null when it can.
 *
 * Two different refusals because they need two different next steps: a
 * Business Manager holding numbers needs them moved or removed first, while
 * one holding only connected accounts needs those disconnected. Saying
 * "still in use" for both would leave the admin guessing which.
 */
export function blockBusinessManagerRemoval(input: {
  name: string;
  accountCount: number;
  numberCount: number;
}): RemovalBlock | null {
  if (input.accountCount <= 0) return null;

  if (input.numberCount > 0) {
    const numbers = `${input.numberCount} WhatsApp number${input.numberCount === 1 ? '' : 's'}`;
    return {
      code: 'META_APP_IN_USE',
      message:
        `${input.name} still holds ${numbers}. Move them to another Business Manager, or remove them, ` +
        'before removing this one.',
    };
  }

  const accounts = `${input.accountCount} connected WhatsApp account${input.accountCount === 1 ? '' : 's'}`;
  return {
    code: 'META_APP_IN_USE',
    message: `${input.name} still holds ${accounts}. Disconnect them before removing this Business Manager.`,
  };
}
