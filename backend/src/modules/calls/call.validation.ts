import { z } from 'zod';

export const listCallsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const initiateCallSchema = z.object({
  contactId: z.string().min(1),
});

export const callIdParamSchema = z.object({
  // Meta's own call id. Opaque, so only bounded — a pattern guessing at its
  // format would start rejecting valid ids the day Meta changes it.
  callId: z.string().trim().min(1).max(256),
});

export const answerCallSchema = z.object({
  // The device's WebRTC answer. Large — a full SDP with ICE candidates runs
  // to a few KB — so the cap is generous rather than tight.
  sdp: z.string().min(1).max(64_000),
});
