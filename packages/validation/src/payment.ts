import { z } from "zod";

// Required, not generated server-side: the client owns the retry/double-click boundary (one
// "Pay" click = one key), which is what lets a duplicate submission map back to the same payment
// instead of the server having to guess whether two requests were "the same click."
const idempotencyKeySchema = z.string().min(8).max(128);

export const createPaymentSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export const refundPaymentSchema = z.object({
  // Omitted = full refund of whatever remains unrefunded — computed server-side in
  // payment.service.ts, never trusted from the client even when supplied.
  amount: z.number().positive().optional(),
  reason: z.string().max(500).optional(),
  idempotencyKey: idempotencyKeySchema,
});
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;

export const mockCompletePaymentSchema = z.object({
  outcome: z.enum(["paid", "failed"]),
});
export type MockCompletePaymentInput = z.infer<typeof mockCompletePaymentSchema>;
