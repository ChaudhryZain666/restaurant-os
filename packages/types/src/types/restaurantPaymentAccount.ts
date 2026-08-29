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
  connectedByUserId: string;
  createdAt: string;
  updatedAt: string;
}
