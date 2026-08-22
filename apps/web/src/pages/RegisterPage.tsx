import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, type Location } from "react-router-dom";
import { Alert, Button, Card } from "@restaurant/ui";
import { useAuth } from "../context/AuthContext";
import { useNoIndex } from "../hooks/useNoIndex";

export function RegisterPage() {
  useNoIndex();
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register(name, email, password);
      // See LoginPage — return to the restaurant-scoped page the customer started from, if any.
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
        <h1 className="font-heading text-2xl font-semibold text-foreground">Create account</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label htmlFor="register-name" className="flex flex-col gap-1 text-sm font-medium text-foreground">
            Name
            <input
              id="register-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              className="rounded-md border border-border bg-surface px-3 py-2 text-base font-normal"
            />
          </label>
          <label htmlFor="register-email" className="flex flex-col gap-1 text-sm font-medium text-foreground">
            Email
            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="rounded-md border border-border bg-surface px-3 py-2 text-base font-normal"
            />
          </label>
          <label htmlFor="register-password" className="flex flex-col gap-1 text-sm font-medium text-foreground">
            Password
            <input
              id="register-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              autoComplete="new-password"
              className="rounded-md border border-border bg-surface px-3 py-2 text-base font-normal"
            />
          </label>
          {error && (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          )}
          <Button type="submit" disabled={submitting} size="lg">
            {submitting ? "Creating account..." : "Create account"}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-primary hover:opacity-80">
          Log in
        </Link>
      </p>
    </div>
  );
}
