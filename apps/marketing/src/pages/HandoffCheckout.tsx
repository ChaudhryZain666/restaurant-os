import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Spinner } from "@restaurant/ui";
import { Section } from "../components/Section";
import { IconCheck } from "../components/icons";
import { apiClient } from "../lib/api";
import { initPaddle, type PaddleEventData } from "../lib/paddle";

/**
 * Subscribe from inside the app (Billing → Subscribe), completed here: the app's checkout is handed
 * to this page because Paddle only opens its form on a domain it approved (garnishtable.com). The
 * link carries a one-time token in the URL fragment (#handoff=…), never sent to a server in the URL.
 * The API returns exactly the checkout the app used to open itself (same price, Paddle customer and
 * custom data), so the signed webhook links the subscription to the owner as before. This page never
 * grants anything; it only opens the form and sends the owner back to Billing.
 */

interface Handoff {
  clientToken: string;
  environment: "sandbox" | "production";
  providerPriceId: string;
  providerCustomerId: string;
  customData: Record<string, string>;
  planName: string;
  billingInterval: "monthly" | "yearly";
  returnUrl: string;
}

type Phase = "loading" | "paying" | "closed" | "paid" | "error";

export function HandoffCheckout({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const paidRef = useRef(false);

  const onEvent = useCallback((event: PaddleEventData) => {
    if (event.name === "checkout.completed") {
      paidRef.current = true;
      setPhase("paid");
    }
    if (event.name === "checkout.closed" && !paidRef.current) setPhase("closed");
  }, []);

  const open = useCallback(
    async (h: Handoff) => {
      const paddle = await initPaddle({ clientToken: h.clientToken, environment: h.environment }, onEvent);
      setPhase("paying");
      paddle.Checkout.open({
        items: [{ priceId: h.providerPriceId, quantity: 1 }],
        customer: { id: h.providerCustomerId },
        customData: h.customData,
        settings: { displayMode: "overlay", theme: "light", allowLogout: false },
      });
    },
    [onEvent]
  );

  useEffect(() => {
    // The token stays in memory only: take it out of the address bar.
    window.history.replaceState(null, "", window.location.pathname);
    apiClient
      .request<Handoff>("/public/checkout/handoff", { method: "POST", body: { token } })
      .then((h) => {
        setHandoff(h);
        return open(h);
      })
      .catch((e: Error) => {
        setError(e.message);
        setPhase("error");
      });
  }, [token, open]);

  // Back to Billing a few seconds after paying; the plan shows there once Paddle confirms it.
  useEffect(() => {
    if (phase !== "paid" || !handoff) return;
    const t = window.setTimeout(() => window.location.assign(handoff.returnUrl), 4000);
    return () => window.clearTimeout(t);
  }, [phase, handoff]);

  const interval = handoff?.billingInterval === "yearly" ? "annual" : "monthly";
  return (
    <Section>
      <Card className="mx-auto flex max-w-lg flex-col gap-4 text-left">
        {phase === "loading" && (
          <div className="flex items-center gap-3">
            <Spinner />
            <h1 className="font-heading text-xl font-semibold text-foreground">Opening secure checkout…</h1>
          </div>
        )}
        {phase === "paying" && handoff && (
          <>
            <h1 className="font-heading text-xl font-semibold text-foreground">Complete your subscription</h1>
            <p className="text-sm text-muted">
              {handoff.planName} ({interval}). The secure payment form is open; it's provided by Paddle, our payment provider.
            </p>
          </>
        )}
        {phase === "closed" && handoff && (
          <>
            <h1 className="font-heading text-xl font-semibold text-foreground">Checkout closed</h1>
            <p className="text-sm text-muted">Nothing was charged. You can open the payment form again, or go back to Billing.</p>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void open(handoff)}>Open payment form</Button>
              <a href={handoff.returnUrl.replace(/\?checkout=complete$/, "")}>
                <Button variant="secondary">Back to Billing</Button>
              </a>
            </div>
          </>
        )}
        {phase === "paid" && handoff && (
          <>
            <div className="flex items-center gap-2 text-success">
              <IconCheck className="h-5 w-5" />
              <h1 className="font-heading text-xl font-semibold text-foreground">Payment received</h1>
            </div>
            <p className="text-sm text-foreground/80">
              Thank you. Your {handoff.planName} plan shows as active on your Billing page within a minute, once Paddle confirms it. Taking
              you back now…
            </p>
            <a href={handoff.returnUrl}>
              <Button className="w-full">Back to Billing</Button>
            </a>
          </>
        )}
        {phase === "error" && (
          <>
            <h1 className="font-heading text-xl font-semibold text-foreground">This checkout link can't be used</h1>
            <Alert tone="danger">{error}</Alert>
          </>
        )}
      </Card>
    </Section>
  );
}
