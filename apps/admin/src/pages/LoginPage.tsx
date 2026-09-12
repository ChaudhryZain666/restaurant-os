import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Logo } from "@restaurant/ui";
import { useAuth } from "../context/AuthContext";
import { roleHomePath } from "../lib/roleHome";

const inputClass = "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";

export function LoginPage() {
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
      const user = await login(email, password);
      // Phase 73 — a direct, unauthenticated hit to a route like /pos gets bounced here by
      // RequireAuth with the original path in location.state.from; returning there (rather than
      // always going to the role's generic home) is what makes "open the POS URL, sign in, land
      // on POS" work without an Owner Portal detour. Falls back to the normal role-home mapping
      // when there was no specific destination (e.g. navigating to /login directly). RequireAuth
      // independently re-checks permission on render, so an invalid/unauthorized `from` (stale,
      // tampered, or simply a page this role can't reach) just bounces to the role's home exactly
      // as before — this is a UX convenience, never a second authorization path.
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from || roleHomePath(user.role));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm animate-scale-in">
        <div className="mb-5">
          <Logo />
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
          <h1 className="font-heading text-2xl font-semibold text-foreground">Sign in</h1>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Email
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            <span className="flex items-center justify-between">
              Password
              <Link to="/forgot-password" className="text-xs font-medium text-primary hover:underline">
                Forgot password?
              </Link>
            </span>
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          )}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
          <p className="text-center text-xs text-muted">
            Starting an agency?{" "}
            <Link to="/start" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </p>
        </form>
      </Card>
    </div>
  );
}
