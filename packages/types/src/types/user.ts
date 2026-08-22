import type { UserRole } from "./rbac.js";

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** Present only for restaurant-scoped roles (owner/manager/staff/kitchen_staff). */
  restaurantId?: string;
  phone?: string;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** A restaurant's manager/staff/kitchen_staff account, as shown on the owner's Staff page. */
export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
  isActive: boolean;
  /** True until they've followed their invite email and set their own password. */
  invitePending: boolean;
  createdAt: string;
}
