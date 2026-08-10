import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicUser } from "@restaurant/shared";
import { api, setAccessToken } from "../lib/api";

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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ accessToken: string }>("/auth/refresh", { method: "POST", skipRefresh: true })
      .then(async (data) => {
        setAccessToken(data.accessToken);
        const { user } = await api<{ user: PublicUser }>("/auth/me");
        setUser(user);
      })
      .catch(() => setAccessToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const data = await api<AuthResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
      skipRefresh: true,
    });
    setAccessToken(data.accessToken);
    setUser(data.user);
  }

  async function register(name: string, email: string, password: string) {
    const data = await api<AuthResponse>("/auth/register", {
      method: "POST",
      body: { name, email, password },
      skipRefresh: true,
    });
    setAccessToken(data.accessToken);
    setUser(data.user);
  }

  async function logout() {
    await api("/auth/logout", { method: "POST", skipRefresh: true });
    setAccessToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
