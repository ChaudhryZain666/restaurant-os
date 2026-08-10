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
