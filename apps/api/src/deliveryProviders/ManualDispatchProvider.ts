import { randomUUID } from "node:crypto";
import type {
  CreateDeliveryInput,
  DeliveryProvider,
  DeliveryQuoteInput,
  DeliveryQuoteResult,
  ProviderDeliveryResult,
  ProviderDeliverySnapshot,
  ProviderDeliveryWebhookEvent,
} from "./DeliveryProvider.js";

/**
 * The restaurant's own fleet/rider — explicitly called out as essential in this phase's brief, not
 * a stub standing in for "no real provider configured." Every restaurant gets this for free, no
 * account, no credentials, no external network call ever made. There is no courier-dispatch API to
 * call, so `createDelivery` simply opens a real Delivery record that STAFF then drive forward by
 * hand (see deliveryDispatch.service.ts's updateStatus — the same function a webhook would call for
 * a third-party provider, called instead from an explicit staff action for this one). This is the
 * reference implementation proving the DeliveryProvider contract holds end-to-end even for a
 * provider with no network calls at all.
 *
 * `status: "accepted"` immediately on creation is deliberate: there is no external accept/reject
 * step for a restaurant's own rider — choosing "manual" IS the restaurant accepting responsibility
 * for the run. Everything after that (driver_assigned, picked_up, out_for_delivery, delivered) is
 * staff-driven, one explicit action at a time.
 */
export class ManualDispatchProvider implements DeliveryProvider {
  readonly name = "manual";
  readonly signatureHeaderName = undefined;

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async getQuote(input: DeliveryQuoteInput): Promise<DeliveryQuoteResult> {
    return { fee: 0, currency: input.currency, raw: { provider: "manual" } };
  }

  async createDelivery(input: CreateDeliveryInput): Promise<ProviderDeliveryResult> {
    return {
      providerDeliveryId: `manual_${randomUUID()}`,
      status: "accepted",
      raw: { provider: "manual", orderId: input.orderId },
    };
  }

  async getDelivery(providerDeliveryId: string): Promise<ProviderDeliverySnapshot> {
    // Nothing to poll — this provider never diverges from whatever deliveryDispatch.service.ts's
    // own Delivery document already says, since staff actions are the only thing that ever change
    // it. Callers that unconditionally poll every delivery for status-sync (see
    // queues/delivery.queue.ts) skip "manual" deliveries entirely rather than calling this.
    return { providerDeliveryId, status: "accepted", raw: { provider: "manual" } };
  }

  async cancelDelivery(): Promise<{ cancelled: boolean }> {
    return { cancelled: true };
  }

  verifyWebhookSignature(): ProviderDeliveryWebhookEvent | null {
    return null;
  }
}
