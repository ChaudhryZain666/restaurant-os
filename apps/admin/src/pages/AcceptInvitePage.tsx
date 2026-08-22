import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Card } from "@restaurant/ui";
import { useAuth } from "../context/AuthContext";

export function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await acceptInvite(token, password);
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {!token ? (
          <Alert tone="danger" role="alert">
            This invitation link is missing its token. Ask whoever invited you to send a new one.
          </Alert>
        ) : (
          <Card className="animate-scale-in flex flex-col gap-4">
            <div className="mb-1 flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary font-heading text-base font-bold text-primary-foreground">
                T
              </span>
              <span className="font-heading text-lg font-semibold text-foreground">Tablecloth</span>
            </div>
            <h1 className="font-heading text-2xl font-semibold text-foreground">Set your password</h1>
            <p className="text-sm text-muted">Choose a password to finish accepting your invitation.</p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-left">
              <label className="flex flex-col gap-1 text-sm text-foreground">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </label>
              {error && (
                <Alert tone="danger" role="alert">
                  {error}
                </Alert>
              )}
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Setting up..." : "Accept invitation"}
              </Button>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
