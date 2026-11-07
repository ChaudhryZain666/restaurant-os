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

// Platform-admin manual subscriptions (provider "manual" — see platformSubscription.service.ts).
// Dates are ISO strings; amounts are integer cents per billing interval.
const isoDate = z.string().datetime({ offset: true });
const agreedAmountCents = z.number().int().min(0).max(100_000_00);
const adminNote = z.string().trim().max(500);

export const createManualSubscriptionSchema = z
  .object({
    planCode: z.string().min(1),
    billingInterval: z.enum(["monthly", "yearly"]),
    kind: z.enum(["complimentary", "offline"]),
    /** Offline only — defaults to the plan's own price for the interval when omitted. */
    amountCents: agreedAmountCents.optional(),
    startsAt: isoDate.optional(),
    endsAt: isoDate,
    note: adminNote.optional(),
  })
  .refine((v) => v.kind !== "complimentary" || v.amountCents === undefined || v.amountCents === 0, {
    message: "A complimentary subscription has no price",
    path: ["amountCents"],
  });
export type CreateManualSubscriptionInput = z.infer<typeof createManualSubscriptionSchema>;

export const extendManualSubscriptionSchema = z.object({ endsAt: isoDate, note: adminNote.optional() });
export type ExtendManualSubscriptionInput = z.infer<typeof extendManualSubscriptionSchema>;

export const changeManualSubscriptionPlanSchema = z.object({
  planCode: z.string().min(1),
  billingInterval: z.enum(["monthly", "yearly"]),
  /** Offline only — defaults to the new plan's price for the interval when omitted. */
  amountCents: agreedAmountCents.optional(),
  note: adminNote.optional(),
});
export type ChangeManualSubscriptionPlanInput = z.infer<typeof changeManualSubscriptionPlanSchema>;

export const suspendManualSubscriptionSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type SuspendManualSubscriptionInput = z.infer<typeof suspendManualSubscriptionSchema>;

export const adminCancelSubscriptionSchema = z.object({
  /** "immediately" applies to manual subscriptions only; a provider-paid one always runs to its period end. */
  when: z.enum(["immediately", "period_end"]),
  note: adminNote.optional(),
});
export type AdminCancelSubscriptionInput = z.infer<typeof adminCancelSubscriptionSchema>;

// Dev/test-only — see billingMockDriver.controller.ts. "trialing" is excluded: every subscription
// already starts there, so there's nothing to "advance" it back to.
export const mockAdvanceSubscriptionSchema = z.object({
  status: z.enum(["active", "past_due", "cancelled"]),
});
export type MockAdvanceSubscriptionInput = z.infer<typeof mockAdvanceSubscriptionSchema>;
