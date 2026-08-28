import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicUser } from "@restaurant/types";
import { apiClient } from "../lib/api";
import { socket } from "../lib/socket";

interface AuthResponse {
  user: PublicUser;
  accessToken: string;
}

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (updates: { name?: string; phone?: string }) => Promise<void>;
  /** Phase 32 — mints a throwaway isDemoAccount:true customer session for the public storefront
   *  playground (POST /auth/demo-session). No credentials involved; returns the same
   *  {user, accessToken} shape login()/register() do, so placeOrder() etc. need no special-casing
   *  once this resolves. A no-op if a session (demo or real) already exists. */
  startDemoSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // A request elsewhere in the app can discover the session is genuinely over (refresh token
    // expired/revoked, not just a transiently-stale access token) — see apiClient.ts's request().
    // Without this, a customer mid-session would keep looking "logged in" while every subsequent
    // request quietly failed, since nothing was clearing `user` outside of an explicit logout().
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

  // Connects once a user is known (login, register, or a successful refresh-on-mount) and
  // disconnects on logout — one socket for the whole session, not one per component that happens
  // to want live updates.
  useEffect(() => {
    if (user) socket.connect();
    else socket.disconnect();
  }, [user]);

  async function login(email: string, password: string) {
    const data = await apiClient.request<AuthResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
      skipRefresh: true,
    });
    apiClient.setAccessToken(data.accessToken);
    setUser(data.user);
  }

  async function register(name: string, email: string, password: string) {
    const data = await apiClient.request<AuthResponse>("/auth/register", {
      method: "POST",
      body: { name, email, password },
      skipRefresh: true,
    });
    apiClient.setAccessToken(data.accessToken);
    setUser(data.user);
  }

  async function startDemoSession() {
    if (user) return;
    const data = await apiClient.request<AuthResponse>("/auth/demo-session", { method: "POST", skipRefresh: true });
    apiClient.setAccessToken(data.accessToken);
    setUser(data.user);
  }

  async function logout() {
    await apiClient.request("/auth/logout", { method: "POST", skipRefresh: true });
    apiClient.setAccessToken(null);
    setUser(null);
  }

  async function updateProfile(updates: { name?: string; phone?: string }) {
    const data = await apiClient.request<{ user: PublicUser }>("/auth/me", { method: "PATCH", body: updates });
    setUser(data.user);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateProfile, startDemoSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
