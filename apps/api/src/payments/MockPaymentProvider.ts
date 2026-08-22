import { randomBytes, randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import type {
  CreateIntentInput,
  PaymentProvider,
  ProviderIntent,
  ProviderPaymentSnapshot,
  ProviderPaymentStatus,
  ProviderRefundResult,
  ProviderWebhookEvent,
} from "./PaymentProvider.js";

interface MockRecord {
  status: ProviderPaymentStatus;
  amount: number;
  currency: string;
  orderId: string;
  restaurantId: string;
}

/**
 * A deterministic, clearly-fake payment provider — the only adapter that actually runs in this
 * codebase today. It exists to make the entire payment pipeline (intent creation, webhook
 * signature verification, idempotent event processing, refunds) genuinely exercisable in
 * development and tests without real provider credentials.
 *
 * What's real about it: signature verification is a real HMAC-SHA256 check against
 * MOCK_PAYMENT_WEBHOOK_SECRET, using the same code path a real provider's webhook would go
 * through. What's fake: no money ever moves, "payment succeeded" here means nothing beyond this
 * process's own in-memory bookkeeping, and that bookkeeping does not survive a server restart
 * (a real provider's state lives with the provider, not the app process — this is the one place
 * the mock deliberately diverges from real-provider shape, since persisting fake transaction
 * state would misrepresent what this is). Never reachable outside PAYMENT_PROVIDER=mock, and the
 * routes that drive it (see controllers/paymentMockDriver.controller.ts) don't exist at all
 * unless that env var is set — see payments/index.ts.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  readonly signatureHeaderName = "x-payment-signature";
  private readonly secret: string;
  private readonly records = new Map<string, MockRecord>();

  constructor(webhookSecret: string) {
    this.secret = webhookSecret;
  }

  async createIntent(input: CreateIntentInput): Promise<ProviderIntent> {
    const providerRef = `mock_pi_${randomBytes(12).toString("hex")}`;
    this.records.set(providerRef, {
      status: "pending",
      amount: input.amount,
      currency: input.currency,
      orderId: input.orderId,
      restaurantId: input.restaurantId,
    });
    return { providerRef, status: "pending", clientSecret: `mock_secret_${providerRef}` };
  }

  async retrieve(providerRef: string): Promise<ProviderPaymentSnapshot> {
    const record = this.records.get(providerRef);
    if (!record) throw new Error(`Unknown mock payment reference: ${providerRef}`);
    return { providerRef, status: record.status, amount: record.amount, currency: record.currency, raw: record };
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): ProviderWebhookEvent | null {
    if (!signatureHeader) return null;
    const expected = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    const provided = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;

    const expectedBuf = Buffer.from(expected, "hex");
    const providedBuf = Buffer.from(provided, "hex");
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) return null;

    try {
      const parsed = JSON.parse(rawBody.toString("utf-8"));
      if (!parsed.eventId || !parsed.eventType || !parsed.providerRef || !parsed.status) return null;
      return {
        eventId: parsed.eventId,
        eventType: parsed.eventType,
        providerRef: parsed.providerRef,
        status: parsed.status,
        raw: parsed,
      };
    } catch {
      return null;
    }
  }

  async refund(providerRef: string, _amount: number, _reason?: string): Promise<ProviderRefundResult> {
    const record = this.records.get(providerRef);
    if (!record) throw new Error(`Unknown mock payment reference: ${providerRef}`);
    // A mock, deterministic "succeeded" — no money moves. See the class doc-comment.
    return { refundRef: `mock_re_${randomBytes(12).toString("hex")}`, status: "succeeded" };
  }

  // --- Mock-only driver surface below: not part of PaymentProvider, only ever called from the
  // dev-only mock-driver controller, which itself only registers routes when
  // env.PAYMENT_PROVIDER === "mock". ---

  /** Flips the in-memory record and returns an UNSIGNED webhook payload for the caller to sign
   *  and submit through the real /webhooks/payments/mock HTTP path (or the equivalent internal
   *  call in tests) — simulating what a real provider would push after the customer finishes
   *  paying on its hosted page. */
  simulateOutcome(providerRef: string, outcome: "paid" | "failed"): Record<string, unknown> {
    const record = this.records.get(providerRef);
    if (!record) throw new Error(`Unknown mock payment reference: ${providerRef}`);
    record.status = outcome;
    return {
      eventId: `mock_evt_${randomUUID()}`,
      eventType: outcome === "paid" ? "payment.succeeded" : "payment.failed",
      providerRef,
      status: outcome,
    };
  }

  /** Signs a payload exactly as verifyWebhookSignature expects — used to construct a realistic
   *  request when driving the mock flow end to end. */
  signPayload(payload: Record<string, unknown>): { rawBody: Buffer; signatureHeader: string } {
    const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
    const signature = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    return { rawBody, signatureHeader: `sha256=${signature}` };
  }
}
