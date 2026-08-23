/** Phase 18/19 — the brand/commercial entity that owns one or more Restaurant (location)
 *  documents. See docs/multi-tenant-storefront-architecture.md's Phase 18 section for why
 *  Restaurant itself represents the physical location rather than being renamed. */
export interface Business {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  coverImage?: string;
  ownerId: string;
  status: "pending" | "active" | "suspended";
  brandColor?: string;
  /** Phase 25 — optional, additive. Which Agency manages this business, if any. Never replaces
   *  `ownerId` (the actual business-owner User, unchanged): a business can exist independently
   *  (unset) or be managed by an Agency (set) — see docs/multi-tenant-storefront-architecture.md's
   *  Phase 25 section. */
  agencyId?: string;
  createdAt: string;
}
