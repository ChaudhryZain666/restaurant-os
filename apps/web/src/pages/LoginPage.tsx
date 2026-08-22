import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, type Location } from "react-router-dom";
import { Alert, Button, Card } from "@restaurant/ui";
import { useAuth } from "../context/AuthContext";
import { useNoIndex } from "../hooks/useNoIndex";

export function LoginPage() {
  useNoIndex();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      // Return to wherever RequireAuth (or CartPage's checkout guard) sent the customer from —
      // most importantly, back to the restaurant-scoped page they were on, not the platform
      // default (see RequireAuth.tsx).
      const from = (location.state as { from?: Location } | null)?.from;
      navigate(from ? `${from.pathname}${from.search}` : "/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4">
      <Card className="animate-scale-in flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Log in</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label htmlFor="login-email" className="flex flex-col gap-1 text-sm font-medium text-foreground">
            Email
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="rounded-md border border-border bg-surface px-3 py-2 text-base font-normal"
            />
          </label>
          <label htmlFor="login-password" className="flex flex-col gap-1 text-sm font-medium text-foreground">
            <span className="flex items-center justify-between">
              Password
              <Link to="/forgot-password" className="text-xs font-medium text-primary hover:opacity-80">
                Forgot password?
              </Link>
            </span>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="rounded-md border border-border bg-surface px-3 py-2 text-base font-normal"
            />
          </label>
          {error && (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          )}
          <Button type="submit" disabled={submitting} size="lg">
            {submitting ? "Logging in..." : "Log in"}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-muted">
        New here?{" "}
        <Link to="/register" className="font-medium text-primary hover:opacity-80">
          Create an account
        </Link>
      </p>
    </div>
  );
}
