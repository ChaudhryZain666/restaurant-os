import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { UserRole } from "@restaurant/types";
import { useAuth } from "../context/AuthContext";

export function RequireAuth({ roles, children }: { roles?: UserRole[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p>Loading...</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
