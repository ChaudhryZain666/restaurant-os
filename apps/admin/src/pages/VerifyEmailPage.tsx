import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";

type Status = "verifying" | "success" | "error";

/**
 * Phase 44 — the missing counterpart to /reset-password and /accept-invite: this is where the
 * link in emailVerificationEmail (auth.controller.ts's sendVerificationEmail) actually points,
 * and until now nothing existed at that URL. Public (POST /auth/verify-email takes no auth — the
 * person clicking may be on a different device/browser than the one that registered), same as the
 * backend route itself.
 *
 * After a successful verify, calls refreshUser() so THIS tab's AuthContext (if it happens to hold
 * the same browser session, e.g. the link was opened in a new tab of the same browser) picks up
 * emailVerifiedAt immediately, rather than leaving OwnerSignupWizardPage to discover it stale.
 * Whether or not a local session exists here, the visible outcome is the same: a confirmation and
 * a link back into the signup wizard, which re-resolves its own step from the account's real state
 * on mount (see OwnerSignupWizardPage's doc comment).
 *
 * The verify-email token is single-use server-side (verifyEmail's atomic find-and-clear — see
 * auth.controller.ts), so this must fire the POST at most once per token no matter how many times
 * the effect body itself runs. React 18 StrictMode intentionally mounts every effect twice in dev,
 * which would otherwise send the same token twice and make the SECOND call fail with "invalid or
 * expired" even though the first one just succeeded (caught live via this page's own e2e spec).
 * requestRef memoizes the one real in-flight/resolved request across both invocations — the same
 * "dedupe concurrent callers onto one shared promise" shape AuthContext's tryRefresh() already uses
 * for the identical single-use-token problem on /auth/refresh.
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const { refreshUser } = useAuth();
  const [status, setStatus] = useState<Status>("verifying");
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<Promise<{ message: string; email: string }> | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("This verification link is missing its token.");
      return;
    }
    let cancelled = false;
    if (!requestRef.current) {
      requestRef.current = apiClient.request<{ message: string; email: string }>("/auth/verify-email", {
        method: "POST",
        body: { token },
      });
    }
    requestRef.current
      .then(async () => {
        // Best-effort — a session may not exist in this tab at all (e.g. a verification link
        // opened somewhere with no cookie yet), and that's fine: the message below still holds.
        await refreshUser().catch(() => null);
        if (!cancelled) setStatus("success");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm animate-scale-in">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary font-heading text-base font-bold text-primary-foreground">
            T
          </span>
          <span className="font-heading text-lg font-semibold text-foreground">Tablecloth</span>
        </div>

        {status === "verifying" && <p className="text-sm text-muted">Verifying your email address...</p>}

        {status === "success" && (
          <div className="flex flex-col gap-4 text-left">
            <h1 className="font-heading text-xl font-semibold text-foreground">Email verified</h1>
            <p className="text-sm text-muted">
              You're all set — head back to finish setting up your restaurant, or sign in if you already have.
            </p>
            <Link to="/signup">
              <Button className="w-full">Continue setting up my restaurant</Button>
            </Link>
            <Link to="/login" className="text-center text-xs text-muted hover:underline">
              Sign in instead
            </Link>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col gap-4 text-left">
            <h1 className="font-heading text-xl font-semibold text-foreground">Verification failed</h1>
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
            <p className="text-sm text-muted">
              This link may have expired or already been used. You can request a new one from the signup flow.
            </p>
            <Link to="/signup">
              <Button className="w-full">Back to signup</Button>
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
