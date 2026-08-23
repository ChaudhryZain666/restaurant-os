import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Card } from "@restaurant/ui";
import { useAuth } from "../context/AuthContext";

/**
 * Phase 25 — mirrors AcceptInvitePage.tsx's shape, for the separate agency-membership invite flow
 * (/agencies/accept-invite, not /auth/accept-invite). A password is only required server-side for
 * a brand-new person; an invite to an already-existing platform account needs none — this page
 * doesn't know upfront which case applies, so the password field is optional here and a missing-
 * password rejection surfaces as a normal inline error prompting the person to fill it in.
 */
export function AcceptAgencyInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const { acceptAgencyInvite } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await acceptAgencyInvite(token, password || undefined);
      navigate("/agency");
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
            <h1 className="font-heading text-2xl font-semibold text-foreground">Accept your agency invitation</h1>
            <p className="text-sm text-muted">
              If you don't have a Tablecloth account yet, set a password below. If you already do, leave it blank.
            </p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-left">
              <label className="flex flex-col gap-1 text-sm text-foreground">
                Password (only if you're new here)
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
                {submitting ? "Accepting..." : "Accept invitation"}
              </Button>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
