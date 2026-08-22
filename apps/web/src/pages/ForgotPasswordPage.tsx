import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useNoIndex } from "../hooks/useNoIndex";

export function ForgotPasswordPage() {
  useNoIndex();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.request("/auth/request-password-reset", { method: "POST", body: { email }, skipRefresh: true });
      setSubmitted(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4">
      <Card className="animate-scale-in flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Reset your password</h1>
        {submitted ? (
          <Alert tone="success">
            If an account exists for <strong>{email}</strong>, we've sent a link to reset your password. It expires
            in 1 hour.
          </Alert>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <p className="text-sm text-muted">Enter your email and we'll send you a link to reset your password.</p>
            <label htmlFor="forgot-email" className="flex flex-col gap-1 text-sm font-medium text-foreground">
              Email
              <input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="rounded-md border border-border bg-surface px-3 py-2 text-base font-normal"
              />
            </label>
            {error && (
              <Alert tone="danger" role="alert">
                {error}
              </Alert>
            )}
            <Button type="submit" disabled={submitting} size="lg">
              {submitting ? "Sending..." : "Send reset link"}
            </Button>
          </form>
        )}
      </Card>
      <p className="text-center text-sm text-muted">
        <Link to="/login" className="font-medium text-primary hover:opacity-80">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
