import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Card, Spinner } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useNoIndex } from "../hooks/useNoIndex";

/**
 * Phase 45 — a real, previously-missing destination. Every /auth/register call sends a real
 * verification email (auth.controller.ts's sendVerificationEmail, unconditional since Phase 37),
 * including every plain customer account created here on the storefront — but until now nothing
 * existed at CLIENT_ORIGIN/verify-email, where that email's link (resolveAppOrigin picks
 * CLIENT_ORIGIN for any request not from the admin app) actually points. Mirrors
 * ConfirmEmailChangePage's shape for consistency with this app's own established pattern.
 *
 * requestRef memoizes the one real in-flight/resolved request so React 18 StrictMode's dev-only
 * double-effect-invocation can't send this single-use token twice (the second call would fail
 * with "invalid or expired" even though the first just succeeded) — the same fix
 * apps/admin's VerifyEmailPage needed for the identical problem; applied here from the start.
 */
export function VerifyEmailPage() {
  useNoIndex();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<"loading" | "done" | "error">(token ? "loading" : "error");
  const [message, setMessage] = useState<string | null>(null);
  const requestRef = useRef<Promise<{ message: string; email: string }> | null>(null);

  useEffect(() => {
    if (!token) return;
    if (!requestRef.current) {
      requestRef.current = apiClient.request<{ message: string; email: string }>("/auth/verify-email", {
        method: "POST",
        body: { token },
      });
    }
    requestRef.current
      .then((data) => {
        setMessage(data.message);
        setStatus("done");
      })
      .catch((err) => {
        setMessage((err as Error).message);
        setStatus("error");
      });
  }, [token]);

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4">
      <Card className="animate-scale-in flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Verify email address</h1>
        {status === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Verifying...
          </p>
        )}
        {status === "done" && <Alert tone="success">{message}</Alert>}
        {status === "error" && (
          <Alert tone="danger" role="alert">
            {message ?? "This verification link is missing its token."}
          </Alert>
        )}
        <Link to="/account" className="text-sm font-medium text-primary hover:underline">
          Back to account
        </Link>
      </Card>
    </div>
  );
}
