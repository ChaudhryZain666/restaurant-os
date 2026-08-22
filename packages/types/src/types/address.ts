/** A customer's saved delivery address — belongs to exactly one User, never shared or looked up by ID alone. */
export interface Address {
  id: string;
  label?: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country?: string;
  /** Optional — entered manually (no geocoding provider is wired up; see
   *  apps/api/src/services/geocoding.service.ts). Required only at the point a customer actually
   *  places a delivery order (see OrderDeliveryAddress) so delivery-radius eligibility can be
   *  checked server-side; a saved address without coordinates still works for display/reuse. */
  latitude?: number;
  longitude?: number;
  isDefault: boolean;
}
