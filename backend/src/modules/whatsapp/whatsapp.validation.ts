import { z } from 'zod';

export const registerPhoneNumberSchema = z.object({
  // Meta phone_number_id: a long numeric string. Constrained to digits so
  // an accidentally-pasted display number (+91 98765…) or WABA id is
  // rejected here rather than sent to Meta as a doomed lookup.
  phoneNumberId: z.string().trim().regex(/^\d{5,25}$/, 'Must be the numeric phone number id from Meta'),
  wabaId: z.string().trim().regex(/^\d{5,25}$/, 'Must be the numeric WhatsApp Business Account id').optional(),
});

export const connectWhatsAppSchema = z.object({
  // The single-use authorization code from Embedded Signup. Length-bounded
  // rather than pattern-matched: Meta does not document its format, and a
  // regex guessing at it would reject valid codes the day they change it.
  code: z.string().trim().min(10).max(2048),
});
