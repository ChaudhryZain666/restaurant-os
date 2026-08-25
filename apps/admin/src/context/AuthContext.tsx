import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicUser } from "@restaurant/types";
import { apiClient } from "../lib/api";
import { socket } from "../lib/socket";

/** Phase 19 — the socket's connect()/disconnect() trigger moved to LocationContext, which needs
 *  to resolve the active location BEFORE the first connection attempt (see its doc comment for
 *  why connecting here, the instant `user` is set, would race ahead of that and cause a
 *  guaranteed extra reconnect for every multi-location user). AuthContext still owns logout's
 *  disconnect — a logged-out session should never keep a socket open regardless of what
 *  LocationContext is doing. */

interface AuthResponse {
  user: PublicUser;
  accessToken: string;
}

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<PublicUser>;
  /** Phase 25 — the admin app's only self-serve entry point, and only for one reason: starting an
   *  agency (every other admin identity — owner/manager/staff/kitchen_staff — is always invited by
   *  someone already in the system, never self-registered here). Creates a plain "customer"-role
   *  account via the same /auth/register endpoint apps/web's storefront registration already uses. */
  register: (name: string, email: string, password: string) => Promise<PublicUser>;
  acceptInvite: (token: string, password: string) => Promise<PublicUser>;
  /** Phase 25 — the agency-membership counterpart, hitting /agencies/accept-invite instead. A
   *  password is optional here (only required server-side for a brand-new account — an invite to
   *  an existing platform user needs none, see agencyMembership.controller.ts's acceptAgencyInvite). */
  acceptAgencyInvite: (token: string, password?: string) => Promise<PublicUser>;
  /** Phase 28 — completes the forced password-change flow for an agency-provisioned "direct
   *  access" account (see ForcePasswordChangePage): re-authenticates with the temporary password
   *  and sets a real one via the same /auth/change-password endpoint the ordinary self-service
   *  change already uses. Updates `user` from the response so RequireAuth stops redirecting the
   *  moment `mustChangePassword` comes back false. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<PublicUser>;
  logout: () => Promise<void>;
  /** Phase 25 — re-derives the access token AND `user` fresh from the server, without a full
   *  login round-trip. Needed after any action that changes claims mid-session (creating an
   *  agency, accepting an agency invite while already logged in as a different identity isn't
   *  possible, but accepting while ALREADY authenticated as the invited account is) — every claim
   *  in this app (businessId, locationIds, and now agencyMemberships) is only ever re-derived at
   *  login/refresh, never live, so the frontend must explicitly ask for a refresh rather than
   *  expect one to happen automatically. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // A request elsewhere in the app can discover the session is genuinely over (refresh token
    // expired/revoked, not just a transiently-stale access token) — see apiClient.ts's request().
    // Without this, a restaurant owner/staff mid-session would keep looking "logged in" while
    // every subsequent request quietly failed, since nothing was clearing `user` outside of an
    // explicit logout().
    apiClient.setOnSessionExpired(() => setUser(null));

    // Goes through the client's deduplicated tryRefresh() rather than a raw request — the
    // refresh token is single-use server-side, so a StrictMode double-mount (or any other
    // concurrent caller) firing two independent /auth/refresh calls would revoke-race itself
    // and surface a spurious "invalid/expired" error even though one of them actually succeeded.
    apiClient
      .tryRefresh()
      .then(async (refreshed) => {
        if (!refreshed) {
          apiClient.setAccessToken(null);
          return;
        }
        const { user } = await apiClient.request<{ user: PublicUser }>("/auth/me");
        setUser(user);
      })
      .catch(() => apiClient.setAccessToken(null))
      .finally(() => setLoading(false));

    return () => apiClient.setOnSessionExpired(null);
  }, []);

  useEffect(() => {
    if (!user) socket.disconnect();
  }, [user]);

  async function login(email: string, password: string) {
    const data = await apiClient.request<AuthResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
      skipRefresh: true,
    });
    apiClient.setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }

  async function register(name: string, email: string, password: string) {
    const data = await apiClient.request<AuthResponse>("/auth/register", {
      method: "POST",
      body: { name, email, password },
      skipRefresh: true,
    });
    apiClient.setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }

  async function acceptInvite(token: string, password: string) {
    const data = await apiClient.request<AuthResponse>("/auth/accept-invite", {
      method: "POST",
      body: { token, password },
      skipRefresh: true,
    });
    apiClient.setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }

  async function acceptAgencyInvite(token: string, password?: string) {
    const data = await apiClient.request<AuthResponse>("/agencies/accept-invite", {
      method: "POST",
      body: { token, ...(password ? { password } : {}) },
      skipRefresh: true,
    });
    apiClient.setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    const data = await apiClient.request<AuthResponse>("/auth/change-password", {
      method: "POST",
      body: { currentPassword, newPassword },
    });
    apiClient.setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }

  async function logout() {
    await apiClient.request("/auth/logout", { method: "POST", skipRefresh: true });
    apiClient.setAccessToken(null);
    setUser(null);
  }

  async function refreshUser() {
    const refreshed = await apiClient.tryRefresh();
    if (!refreshed) return;
    const { user } = await apiClient.request<{ user: PublicUser }>("/auth/me");
    setUser(user);
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, acceptInvite, acceptAgencyInvite, changePassword, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
