import { z } from "zod";

// Phase 24 — owner-facing billing lifecycle request bodies. Cancel/reactivate take no body (the
// subscription id is already in the URL and the target state is implied by the action), so only
// the two actions with real input get a schema here.

export const createSubscriptionSchema = z.object({
  planCode: z.string().min(1),
  billingInterval: z.enum(["monthly", "yearly"]),
});
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

export const changeSubscriptionPlanSchema = z.object({
  planCode: z.string().min(1),
});
export type ChangeSubscriptionPlanInput = z.infer<typeof changeSubscriptionPlanSchema>;

// Dev/test-only — see billingMockDriver.controller.ts. "trialing" is excluded: every subscription
// already starts there, so there's nothing to "advance" it back to.
export const mockAdvanceSubscriptionSchema = z.object({
  status: z.enum(["active", "past_due", "cancelled"]),
});
export type MockAdvanceSubscriptionInput = z.infer<typeof mockAdvanceSubscriptionSchema>;
