import { randomBytes, randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import type {
  BillingProvider,
  CreateBillingCustomerInput,
  CreateProviderSubscriptionInput,
  ProviderBillingCustomer,
  ProviderBillingWebhookEvent,
  ProviderSubscriptionSnapshot,
  ProviderSubscriptionStatus,
} from "./BillingProvider.js";

interface MockCustomerRecord {
  ownerType: "business" | "agency";
  ownerId: string;
}

interface MockSubscriptionRecord {
  status: ProviderSubscriptionStatus;
  planCode: string;
  billingInterval: "monthly" | "yearly";
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEnd?: Date;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A deterministic, clearly-fake billing provider — the only adapter that actually runs in this
 * codebase today (mirrors apps/api/src/payments/MockPaymentProvider.ts's shape and honesty
 * conventions exactly). What's real: signature verification is a real HMAC-SHA256 check against
 * MOCK_BILLING_WEBHOOK_SECRET, the same code path a real provider's webhook would go through. What's
 * fake: no money ever moves, "subscription active" here means nothing beyond this process's own
 * in-memory bookkeeping, and that bookkeeping does not survive a server restart — the one place this
 * mock deliberately diverges from real-provider shape, since persisting fake billing state would
 * misrepresent what this is.
 */
export class MockBillingProvider implements BillingProvider {
  readonly name = "mock";
  readonly signatureHeaderName = "x-billing-signature";
  private readonly secret: string;
  private readonly customers = new Map<string, MockCustomerRecord>();
  private readonly subscriptions = new Map<string, MockSubscriptionRecord>();

  constructor(webhookSecret: string) {
    this.secret = webhookSecret;
  }

  async createCustomer(input: CreateBillingCustomerInput): Promise<ProviderBillingCustomer> {
    const providerCustomerId = `mock_cus_${randomBytes(12).toString("hex")}`;
    this.customers.set(providerCustomerId, { ownerType: input.ownerType, ownerId: input.ownerId });
    return { providerCustomerId };
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

  async changePlan(providerSubscriptionId: string, newPlanCode: string): Promise<ProviderSubscriptionSnapshot> {
    const record = this.subscriptions.get(providerSubscriptionId);
    if (!record) throw new Error(`Unknown mock subscription reference: ${providerSubscriptionId}`);
    record.planCode = newPlanCode;
    return this.snapshot(providerSubscriptionId, record);
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

  // --- Mock-only driver surface below: not part of BillingProvider, only used by tests to drive
  // the real HTTP webhook path end to end — mirrors MockPaymentProvider's simulateOutcome/
  // signPayload pair exactly. ---

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
    return {
      eventId: `mock_evt_${randomUUID()}`,
      eventType: eventTypeByStatus[status],
      providerSubscriptionId,
      status,
    };
  }

  /** Signs a payload exactly as verifyWebhookSignature expects. */
  signPayload(payload: Record<string, unknown>): { rawBody: Buffer; signatureHeader: string } {
    const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
    const signature = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    return { rawBody, signatureHeader: `sha256=${signature}` };
  }
}
