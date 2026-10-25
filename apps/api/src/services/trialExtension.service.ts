import { env } from "../config/env.js";
import { mockDriversAllowed } from "../config/mockDrivers.js";

/**
 * Pre-launch — "trials don't lapse while nobody can pay".
 *
 * Production's paid checkout is unavailable while BILLING_PROVIDER=mock (subscription.service.ts's
 * createCheckoutSessionCore refuses it there), so a restaurant whose 14-day trial ended would lose
 * its plan features — custom domain, analytics, promotions, extra locations — with no way to pay to
 * keep them. While checkout is unavailable and TRIAL_EXTENSION_WHILE_CHECKOUT_UNAVAILABLE is on, a
 * no-card trial (no provider subscription behind it) therefore stays live past its trialEnd
 * (subscriptionResolution.service.ts isSubscriptionLive). Nothing about the trial is rewritten:
 * runTrialExpirationSweep only records `trialExtension.extendedAt/originalTrialEnd`.
 *
 * Reversal is automatic: once checkout is available (a real billing provider in production) or the
 * flag is turned off, the sweep gives each held trial TRIAL_GRACE_AFTER_CHECKOUT_OPENS_DAYS from that
 * moment (and a fresh trial-ending reminder) before normal expiry resumes.
 */
export function paidCheckoutAvailable(): boolean {
  return !(env.BILLING_PROVIDER === "mock" && !mockDriversAllowed(env.NODE_ENV));
}

export function trialExtensionActive(): boolean {
  return env.TRIAL_EXTENSION_WHILE_CHECKOUT_UNAVAILABLE && !paidCheckoutAvailable();
}

/** Whether this particular subscription is a no-card trial the extension applies to. */
export function isExtendableTrial(sub: { status?: string | null; providerSubscriptionId?: string | null; provider?: string | null }): boolean {
  return sub.status === "trialing" && !sub.providerSubscriptionId && sub.provider !== "internal";
}
