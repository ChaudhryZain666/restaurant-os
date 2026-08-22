/**
 * Phase 22 — DTO for a custom domain (apps/api/src/models/DomainMapping.ts). A domain resolves to
 * exactly one Location (`locationId`) — see docs/multi-tenant-storefront-architecture.md's Phase 22
 * section for why a domain maps to a Location rather than a Business. `verificationToken` is only
 * ever included in owner-authenticated responses (list/add/check-verification) — the public
 * `by-domain` storefront-resolution response never returns a DomainMapping at all, only the same
 * `{restaurant, availability, supportIdentity}` shape `by-slug` already returns.
 */

export type DomainMappingStatus = "pending_verification" | "verified" | "active";

export interface DomainMapping {
  id: string;
  hostname: string;
  businessId: string;
  locationId: string;
  status: DomainMappingStatus;
  verificationToken: string;
  /** The exact TXT record host the owner needs to publish `verificationToken` under. */
  verificationRecordHost: string;
  verificationCheckedAt?: string;
  verifiedAt?: string;
  activatedAt?: string;
  createdAt: string;
  updatedAt: string;
}
