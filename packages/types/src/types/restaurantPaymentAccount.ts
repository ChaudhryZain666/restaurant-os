/**
 * DTO for a restaurant's own connected payment account (BYOC —
 * apps/api/src/models/RestaurantPaymentAccount.ts). Never carries the encrypted credential
 * envelope itself — only a display-safe, non-reversible `credentialFingerprint`.
 */

export type RestaurantPaymentAccountProvider = "stripe" | "safepay";
export type RestaurantPaymentAccountStatus = "pending_verification" | "active" | "invalid" | "disconnected";

export interface RestaurantPaymentAccount {
  id: string;
  restaurantId: string;
  businessId: string;
  provider: RestaurantPaymentAccountProvider;
  status: RestaurantPaymentAccountStatus;
  credentialFingerprint: string;
  lastVerifiedAt?: string;
  lastVerificationError?: string;
  // Phase 35 audit fix — set only once a real, signature-verified webhook has actually arrived for
  // this account; absent means credentials were validated at connect time but the owner may not
  // have finished configuring their provider dashboard's webhook yet. See
  // apps/api/src/controllers/paymentWebhook.controller.ts's handleRestaurantAccountWebhook.
  firstWebhookReceivedAt?: string;
  connectedByUserId: string;
  createdAt: string;
  updatedAt: string;
}
