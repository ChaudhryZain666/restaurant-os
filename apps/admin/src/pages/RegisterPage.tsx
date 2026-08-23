import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Card } from "@restaurant/ui";
import { useAuth } from "../context/AuthContext";

const inputClass = "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";

/**
 * Phase 25 — the admin app's only self-serve signup, and only for one reason: starting an agency.
 * Every other admin identity is always invited by someone already in the system. Lands directly on
 * /agency, where a fresh "customer"-role account sees the create-agency form.
 */
export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
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
      navigate("/agency");
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm animate-scale-in">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary font-heading text-base font-bold text-primary-foreground">
            T
          </span>
          <span className="font-heading text-lg font-semibold text-foreground">Tablecloth</span>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
          <h1 className="font-heading text-2xl font-semibold text-foreground">Create your account</h1>
          <p className="text-sm text-muted">For starting an agency that manages multiple businesses.</p>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Full name
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Email
            <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Password
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          {error && (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          )}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Creating account..." : "Create account"}
          </Button>
          <p className="text-center text-xs text-muted">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </Card>
    </div>
  );
}
