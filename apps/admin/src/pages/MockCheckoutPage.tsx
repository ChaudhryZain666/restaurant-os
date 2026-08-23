import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";

/**
 * Phase 27 — the mock billing provider's stand-in for a real hosted checkout page (Paddle's own
 * overlay would render here instead, once a real provider is configured). Public route (no auth) —
 * the opaque token in the URL is the only credential, exactly like a real provider's checkout
 * redirect would carry. Clicking the button drives the SAME signature-verified webhook path a real
 * payment confirmation would (POST /billing/mock-checkout/:token/complete ->
 * processBillingProviderEvent) — never a direct database write pretending payment succeeded.
 */
export function MockCheckoutPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.request(`/billing/mock-checkout/${token}/complete`, { method: "POST" });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="flex w-full max-w-md flex-col gap-4 text-center">
        <h1 className="font-heading text-xl font-semibold text-foreground">Mock checkout</h1>
        <p className="text-sm text-muted">
          No real payment provider is connected. This stub stands in for a real hosted checkout page
          (e.g. Paddle's own overlay) and drives the exact same webhook-confirmation path a real
          payment would.
        </p>
        {error && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        {done ? (
          <>
            <Alert tone="success">Payment confirmed — your subscription is now active.</Alert>
            <Button size="sm" onClick={() => navigate("/billing")}>
              Back to billing
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={complete} disabled={busy}>
            {busy ? "Confirming..." : "Confirm mock payment"}
          </Button>
        )}
      </Card>
    </div>
  );
}
