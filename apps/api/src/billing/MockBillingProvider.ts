import { randomBytes, randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import type {
  BillingProvider,
  CreateBillingCustomerInput,
  CreateCheckoutSessionInput,
  CreateProviderSubscriptionInput,
  ProviderBillingCustomer,
  ProviderBillingWebhookEvent,
  ProviderCheckoutSession,
  ProviderInvoice,
  ProviderSubscriptionSnapshot,
  ProviderSubscriptionStatus,
} from "./BillingProvider.js";

interface MockCustomerRecord {
  ownerType: "business" | "agency";
  ownerId: string;
  email: string;
  name: string;
}

interface MockSubscriptionRecord {
  status: ProviderSubscriptionStatus;
  planCode: string;
  billingInterval: "monthly" | "yearly";
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEnd?: Date;
}

interface MockCheckoutRecord {
  providerCustomerId: string;
  providerPriceId: string;
  metadata: Record<string, string>;
}

interface MockInvoiceRecord {
  status: "paid" | "pending" | "failed";
  amountCents: number;
  currency: string;
  issuedAt: Date;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A deterministic, clearly-fake billing provider — the only adapter that actually runs in this
 * codebase's automated tests (mirrors apps/api/src/payments/MockPaymentProvider.ts's shape and
 * honesty conventions exactly). What's real: signature verification is a real HMAC-SHA256 check
 * against MOCK_BILLING_WEBHOOK_SECRET, the same code path a real provider's webhook would go
 * through. What's fake: no money ever moves, "subscription active" here means nothing beyond this
 * process's own in-memory bookkeeping, and that bookkeeping does not survive a server restart — the
 * one place this mock deliberately diverges from real-provider shape, since persisting fake billing
 * state would misrepresent what this is.
 *
 * Phase 27 — gained a checkout-session flow: createCheckoutSession stores a PENDING record (no
 * providerSubscriptionId yet, mirroring how a real checkout has no subscription until payment
 * actually completes) keyed by an opaque token; the mock-only completeCheckoutSession driver
 * (called from the admin app's mock checkout stub page, never directly by a test asserting success)
 * is what actually mints a subscription and returns a webhook payload carrying the original
 * checkout's metadata — the same "drive it through the real HTTP webhook path, never a shortcut DB
 * write" discipline mockAdvanceSubscription already established for status transitions.
 */
export class MockBillingProvider implements BillingProvider {
  readonly name = "mock";
  readonly signatureHeaderName = "x-billing-signature";
  private readonly secret: string;
  private readonly customers = new Map<string, MockCustomerRecord>();
  private readonly subscriptions = new Map<string, MockSubscriptionRecord>();
  private readonly checkouts = new Map<string, MockCheckoutRecord>();
  private readonly invoices = new Map<string, MockInvoiceRecord>();

  constructor(webhookSecret: string) {
    this.secret = webhookSecret;
  }

  /** Phase 40.3 — mirrors PaddleBillingProvider's real, live-verified idempotent-per-email contract
   *  (a real Paddle account 409s a second customer created with an already-used email) so the
   *  customer-reuse fix's edge cases are unit-testable without a live Paddle call: reuse an existing
   *  customer for the same owner, but never silently merge across two different owners. An empty
   *  email never participates in reuse lookup — real callers always resolve a real owner email
   *  (resolveOwnerIdentity), so an empty string only ever occurs when a test fixture never linked a
   *  business's ownerId to a real User; treating that shared "" as one identity would falsely
   *  collide unrelated test owners against each other, which never happened before this fix since
   *  the old code didn't dedupe by email at all. */
  async createCustomer(input: CreateBillingCustomerInput): Promise<ProviderBillingCustomer> {
    const existing = input.email ? [...this.customers.entries()].find(([, record]) => record.email === input.email) : undefined;
    if (existing) {
      const [providerCustomerId, record] = existing;
      if (record.ownerType !== input.ownerType || record.ownerId !== input.ownerId) {
        throw new Error(
          `Mock customer email is already associated with a different owner (existing mock customer ${providerCustomerId}) — refusing to reuse across owners.`
        );
      }
      return { providerCustomerId, email: record.email, name: record.name };
    }
    const providerCustomerId = `mock_cus_${randomBytes(12).toString("hex")}`;
    this.customers.set(providerCustomerId, { ownerType: input.ownerType, ownerId: input.ownerId, email: input.email, name: input.name });
    return { providerCustomerId, email: input.email, name: input.name };
  }

  async retrieveCustomer(providerCustomerId: string): Promise<ProviderBillingCustomer> {
    const record = this.customers.get(providerCustomerId);
    if (!record) throw new Error(`Unknown mock customer reference: ${providerCustomerId}`);
    return { providerCustomerId, email: record.email, name: record.name };
  }

  async createSubscription(input: CreateProviderSubscriptionInput): Promise<ProviderSubscriptionSnapshot> {
    const providerSubscriptionId = `mock_sub_${randomBytes(12).toString("hex")}`;
    const now = new Date();
    const trialEnd = input.trialDays ? new Date(now.getTime() + input.trialDays * 24 * 60 * 60 * 1000) : undefined;
    const record: MockSubscriptionRecord = {
      status: trialEnd ? "trialing" : "active",
      planCode: input.planCode,
      billingInterval: input.billingInterval,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + THIRTY_DAYS_MS),
      trialEnd,
    };
    this.subscriptions.set(providerSubscriptionId, record);
    return this.snapshot(providerSubscriptionId, record);
  }

  async retrieveSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionSnapshot> {
    const record = this.subscriptions.get(providerSubscriptionId);
    if (!record) throw new Error(`Unknown mock subscription reference: ${providerSubscriptionId}`);
    return this.snapshot(providerSubscriptionId, record);
  }

  async cancelSubscription(providerSubscriptionId: string, atPeriodEnd: boolean): Promise<ProviderSubscriptionSnapshot> {
    const record = this.subscriptions.get(providerSubscriptionId);
    if (!record) throw new Error(`Unknown mock subscription reference: ${providerSubscriptionId}`);
    // Immediate cancellation is reflected right away; cancel-at-period-end leaves the provider-side
    // status alone (still "active") — subscription.service.ts is what tracks the OUR-side
    // "cancelling" business state and schedules the real transition for period end.
    if (!atPeriodEnd) record.status = "cancelled";
    return this.snapshot(providerSubscriptionId, record);
  }

  async reactivateSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionSnapshot> {
    const record = this.subscriptions.get(providerSubscriptionId);
    if (!record) throw new Error(`Unknown mock subscription reference: ${providerSubscriptionId}`);
    // Un-cancelling a scheduled (not-yet-effective) cancellation never changed the provider-side
    // status in the first place (see cancelSubscription's atPeriodEnd branch above) — this call
    // exists so the interface is complete for a provider that DOES need telling, and so a real
    // adapter's call site never needs a mock-specific special case.
    return this.snapshot(providerSubscriptionId, record);
  }

  async changePlan(providerSubscriptionId: string, newPlanCode: string): Promise<ProviderSubscriptionSnapshot> {
    const record = this.subscriptions.get(providerSubscriptionId);
    if (!record) throw new Error(`Unknown mock subscription reference: ${providerSubscriptionId}`);
    record.planCode = newPlanCode;
    return this.snapshot(providerSubscriptionId, record);
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<ProviderCheckoutSession> {
    const token = randomBytes(16).toString("hex");
    this.checkouts.set(token, { providerCustomerId: input.providerCustomerId, providerPriceId: input.providerPriceId, metadata: input.metadata });
    return { mode: "redirect", url: `/mock-checkout/${token}`, providerPriceId: input.providerPriceId };
  }

  async retrieveInvoice(providerInvoiceId: string): Promise<ProviderInvoice | null> {
    const record = this.invoices.get(providerInvoiceId);
    if (!record) return null;
    return { providerInvoiceId, status: record.status, amountCents: record.amountCents, currency: record.currency, issuedAt: record.issuedAt };
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): ProviderBillingWebhookEvent | null {
    if (!signatureHeader) return null;
    const expected = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    const provided = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;

    const expectedBuf = Buffer.from(expected, "hex");
    const providedBuf = Buffer.from(provided, "hex");
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) return null;

    try {
      const parsed = JSON.parse(rawBody.toString("utf-8"));
      if (!parsed.eventId || !parsed.eventType || !parsed.providerSubscriptionId || !parsed.status) return null;
      return {
        eventId: parsed.eventId,
        eventType: parsed.eventType,
        providerSubscriptionId: parsed.providerSubscriptionId,
        status: parsed.status,
        raw: parsed,
        checkoutMetadata: parsed.checkoutMetadata,
      };
    } catch {
      return null;
    }
  }

  private snapshot(providerSubscriptionId: string, record: MockSubscriptionRecord): ProviderSubscriptionSnapshot {
    return {
      providerSubscriptionId,
      status: record.status,
      currentPeriodStart: record.currentPeriodStart,
      currentPeriodEnd: record.currentPeriodEnd,
      trialEnd: record.trialEnd,
    };
  }

  // --- Mock-only driver surface below: not part of BillingProvider, only used by tests/the mock
  // checkout stub page to drive the real HTTP webhook path end to end — mirrors
  // MockPaymentProvider's simulateOutcome/signPayload pair exactly. ---

  /** Flips the in-memory record and returns an UNSIGNED webhook payload for the caller to sign and
   *  submit through the real /webhooks/billing/mock HTTP path — simulating what a real provider
   *  would push after a trial converts, a charge fails, or a period-end cancellation lands. */
  simulateEvent(providerSubscriptionId: string, status: ProviderSubscriptionStatus): Record<string, unknown> {
    const record = this.subscriptions.get(providerSubscriptionId);
    if (!record) throw new Error(`Unknown mock subscription reference: ${providerSubscriptionId}`);
    record.status = status;
    const eventTypeByStatus: Record<ProviderSubscriptionStatus, string> = {
      trialing: "subscription.trial_started",
      active: "subscription.activated",
      past_due: "subscription.payment_failed",
      cancelled: "subscription.cancelled",
    };
    // A status-transition event on an existing subscription is also, from the provider's
    // perspective, a payment event (activation = payment succeeded, past_due = payment failed) — an
    // in-memory invoice record is synthesized here too so the mock provider's billing-history/
    // invoice surface has something real to show for it, mirroring what a real webhook payload
    // would carry alongside the status change.
    if (status === "active" || status === "past_due") {
      const invoiceId = `mock_inv_${randomUUID()}`;
      this.invoices.set(invoiceId, {
        status: status === "active" ? "paid" : "failed",
        amountCents: 0,
        currency: "USD",
        issuedAt: new Date(),
      });
    }
    return {
      eventId: `mock_evt_${randomUUID()}`,
      eventType: eventTypeByStatus[status],
      providerSubscriptionId,
      status,
    };
  }

  /** The checkout-session equivalent of simulateEvent — mints a brand-new mock subscription from a
   *  pending checkout record and returns an UNSIGNED webhook payload carrying the original
   *  checkout's metadata, so processBillingProviderEvent can create a Subscription document for the
   *  right owner. Throws if the token is unknown or already completed (checkouts are single-use). */
  completeCheckoutSession(token: string): Record<string, unknown> {
    const checkout = this.checkouts.get(token);
    if (!checkout) throw new Error(`Unknown or already-completed mock checkout: ${token}`);
    this.checkouts.delete(token);

    const providerSubscriptionId = `mock_sub_${randomBytes(12).toString("hex")}`;
    const now = new Date();
    const record: MockSubscriptionRecord = {
      status: "active",
      planCode: checkout.metadata.planCode,
      billingInterval: checkout.metadata.billingInterval as "monthly" | "yearly",
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + THIRTY_DAYS_MS),
    };
    this.subscriptions.set(providerSubscriptionId, record);

    const invoiceId = `mock_inv_${randomUUID()}`;
    this.invoices.set(invoiceId, { status: "paid", amountCents: 0, currency: "USD", issuedAt: now });

    return {
      eventId: `mock_evt_${randomUUID()}`,
      eventType: "subscription.created",
      providerSubscriptionId,
      status: "active",
      checkoutMetadata: { ...checkout.metadata, providerCustomerId: checkout.providerCustomerId },
    };
  }

  /** Signs a payload exactly as verifyWebhookSignature expects. */
  signPayload(payload: Record<string, unknown>): { rawBody: Buffer; signatureHeader: string } {
    const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
    const signature = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    return { rawBody, signatureHeader: `sha256=${signature}` };
  }
}
