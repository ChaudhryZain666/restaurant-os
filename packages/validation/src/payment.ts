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

/** A person settling a held refund (refundPayment's reconciliation). Evidence is always required;
 *  the server adds the rest of the safeguards (hold time, fresh lookup, permission, audit). */
export const resolveRefundSchema = z.object({
  outcome: z.enum(["refunded", "not_refunded"]),
  providerRefundRef: z.string().trim().min(3).max(200).optional(),
  evidence: z.string().trim().min(10, "Explain what you checked (at least 10 characters)").max(1000),
  confirmChecked: z.boolean().default(false),
});
export type ResolveRefundInput = z.infer<typeof resolveRefundSchema>;

export const mockCompletePaymentSchema = z.object({
  outcome: z.enum(["paid", "failed"]),
});
export type MockCompletePaymentInput = z.infer<typeof mockCompletePaymentSchema>;
