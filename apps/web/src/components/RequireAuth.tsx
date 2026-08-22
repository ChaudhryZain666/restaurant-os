import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p>Loading...</p>;
  // Carries the original destination through login so, e.g., an unauthenticated visit to a
  // restaurant-scoped /r/:slug/loyalty page returns to THAT restaurant afterward rather than
  // stranding the customer at the platform default (see LoginPage/RegisterPage).
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}
