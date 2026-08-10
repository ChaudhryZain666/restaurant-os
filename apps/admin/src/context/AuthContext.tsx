import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicUser } from "@restaurant/types";
import { apiClient } from "../lib/api";

interface AuthResponse {
  user: PublicUser;
  accessToken: string;
}

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .request<{ accessToken: string }>("/auth/refresh", { method: "POST", skipRefresh: true })
      .then(async (data) => {
        apiClient.setAccessToken(data.accessToken);
        const { user } = await apiClient.request<{ user: PublicUser }>("/auth/me");
        setUser(user);
      })
      .catch(() => apiClient.setAccessToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const data = await apiClient.request<AuthResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
      skipRefresh: true,
    });
    apiClient.setAccessToken(data.accessToken);
    setUser(data.user);
  }

  async function logout() {
    await apiClient.request("/auth/logout", { method: "POST", skipRefresh: true });
    apiClient.setAccessToken(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
