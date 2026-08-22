import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";

export function ForgotPasswordPage() {
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
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <Card className="animate-scale-in flex flex-col gap-4">
          <h1 className="font-heading text-2xl font-semibold text-foreground">Reset your password</h1>
          {submitted ? (
            <Alert tone="success">
              If an account exists for <strong>{email}</strong>, we've sent a link to reset your password. It expires
              in 1 hour.
            </Alert>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-left">
              <p className="text-sm text-muted">Enter your email and we'll send you a link to reset your password.</p>
              <label className="flex flex-col gap-1 text-sm text-foreground">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </label>
              {error && (
                <Alert tone="danger" role="alert">
                  {error}
                </Alert>
              )}
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Sending..." : "Send reset link"}
              </Button>
            </form>
          )}
        </Card>
        <p className="text-center text-sm text-muted">
          <Link to="/login" className="font-medium text-primary hover:underline">
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  );
}
