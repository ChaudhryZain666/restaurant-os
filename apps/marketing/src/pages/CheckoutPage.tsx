import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Button, Card, Spinner } from "@restaurant/ui";
import { Section } from "../components/Section";
import { IconCheck } from "../components/icons";
import { usePageMeta } from "../hooks/usePageMeta";
import { apiClient } from "../lib/api";
import { ADMIN_URL } from "../lib/links";
import { formatPlanPrice, usePublicPlans, type PublicPlan } from "../lib/plans";
import { initPaddle, type PaddleEventData } from "../lib/paddle";

/**
 * Launch, 2026-11-21 — pay now, no trial, no account: pick a plan, pay in Paddle's checkout, then set
 * up the account. Access is granted from Paddle's verified webhook, which this page waits for
 * (POST /public/checkout/status) — the browser's "completed" event alone never unlocks anything.
 * The set-up token lives in sessionStorage so a reload doesn't lose a paid checkout.
 */

type Interval = "monthly" | "yearly";
type Phase = "choose" | "starting" | "paying" | "confirming" | "paid" | "slow";

interface StartResponse {
  token: string;
  plan: { code: string; name: string; billingInterval: Interval };
  checkout: { clientToken: string; environment: "sandbox" | "production"; providerPriceId: string; customData: Record<string, string> };
}
interface StatusResponse {
  status: "open" | "paid" | "claimed";
  plan: { code: string; name: string };
  billingInterval: Interval;
  email: string | null;
  emailHasAccount: boolean;
}

const STORAGE_KEY = "garnishtable.payNowCheckout";
const POLL_MS = 3000;
const POLL_LIMIT = 40; // two minutes, then "we'll email you"

function readStored(): { token: string; planName: string } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { token: string; planName: string }) : null;
  } catch {
    return null;
  }
}
function store(value: { token: string; planName: string } | null) {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode: the emailed link still works */
  }
}

export function CheckoutPage() {
  usePageMeta({
    title: "Subscribe — GarnishTable",
    description: "Subscribe to GarnishTable and pay now — no trial needed. Set up your restaurant right after payment.",
  });
  const [params] = useSearchParams();
  const { plans, error: plansError, retry } = usePublicPlans();
  const ownerPlans = useMemo(() => (plans ?? []).filter((p) => p.type === "OWNER" && formatPlanPrice(p.pricing, "monthly")), [plans]);

  const [interval, setInterval] = useState<Interval>(params.get("interval") === "yearly" ? "yearly" : "monthly");
  const [selected, setSelected] = useState<string | null>(params.get("plan"));
  const [phase, setPhase] = useState<Phase>("choose");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [planName, setPlanName] = useState<string>("");
  const tokenRef = useRef<string | null>(null);
  const planNameRef = useRef<string>("");
  const pollRef = useRef<number | null>(null);
  const transactionLink = params.get("_ptxn");

  useEffect(() => {
    if (!selected && ownerPlans.length) setSelected(ownerPlans[0].code);
  }, [ownerPlans, selected]);

  const stopPolling = () => {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    pollRef.current = null;
  };

  const poll = useCallback((attempt = 0) => {
    const token = tokenRef.current;
    if (!token) return;
    apiClient
      .request<StatusResponse>("/public/checkout/status", { method: "POST", body: { token } })
      .then((s) => {
        setStatus(s);
        if (s.status === "paid" || s.status === "claimed") {
          setPhase("paid");
          return;
        }
        if (attempt + 1 >= POLL_LIMIT) {
          setPhase("slow");
          return;
        }
        pollRef.current = window.setTimeout(() => poll(attempt + 1), POLL_MS);
      })
      .catch(() => {
        pollRef.current = window.setTimeout(() => poll(attempt + 1), POLL_MS * 2);
      });
  }, []);

  // A reload after paying: pick up where the checkout left off.
  useEffect(() => {
    const stored = readStored();
    if (stored && !transactionLink) {
      tokenRef.current = stored.token;
      setPlanName(stored.planName);
      setPhase("confirming");
      poll();
    }
    return stopPolling;
  }, [poll, transactionLink]);

  // Opened from a Paddle payment link (the account's default payment link): Paddle.js opens it.
  useEffect(() => {
    if (!transactionLink) return;
    apiClient
      .request<{ paddle: { clientToken: string; environment: "sandbox" | "production" } | null }>("/public/checkout/config")
      .then(({ paddle }) => {
        if (!paddle) throw new Error("Online payment isn't available right now.");
        return initPaddle(paddle, () => undefined);
      })
      .catch((e: Error) => setError(e.message));
  }, [transactionLink]);

  const onPaddleEvent = useCallback(
    (event: PaddleEventData) => {
      if (event.name === "checkout.completed") {
        // Saved only now: a checkout closed without paying must not look "paid" after a reload.
        if (tokenRef.current) store({ token: tokenRef.current, planName: planNameRef.current });
        setPhase("confirming");
        poll();
      }
      if (event.name === "checkout.closed") setPhase((p) => (p === "paying" ? "choose" : p));
    },
    [poll]
  );

  async function payNow(plan: PublicPlan) {
    setError(null);
    setPhase("starting");
    try {
      const started = await apiClient.request<StartResponse>("/public/checkout", {
        method: "POST",
        body: { planCode: plan.code, billingInterval: interval },
      });
      tokenRef.current = started.token;
      setPlanName(started.plan.name);
      planNameRef.current = started.plan.name;
      const paddle = await initPaddle(started.checkout, onPaddleEvent);
      setPhase("paying");
      paddle.Checkout.open({
        items: [{ priceId: started.checkout.providerPriceId, quantity: 1 }],
        customData: started.checkout.customData,
        settings: { displayMode: "overlay", theme: "light", allowLogout: false },
      });
    } catch (e) {
      tokenRef.current = null;
      setPhase("choose");
      setError((e as Error).message);
    }
  }

  const setupUrl = tokenRef.current ? `${ADMIN_URL}/claim#token=${tokenRef.current}` : null;

  if (transactionLink) {
    return (
      <Section>
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="font-heading text-2xl font-semibold text-foreground">Complete your payment</h1>
          {error ? <Alert tone="danger">{error}</Alert> : <p className="text-sm text-muted">The secure payment form opens in a moment.</p>}
        </div>
      </Section>
    );
  }

  if (phase === "confirming" || phase === "paid" || phase === "slow") {
    return (
      <Section>
        <Card className="mx-auto flex max-w-lg flex-col gap-4 text-left">
          {phase === "confirming" && (
            <>
              <div className="flex items-center gap-3">
                <Spinner />
                <h1 className="font-heading text-xl font-semibold text-foreground">Confirming your payment…</h1>
              </div>
              <p className="text-sm text-muted">This usually takes a few seconds. Keep this page open.</p>
            </>
          )}
          {phase === "paid" && status && (
            <>
              <div className="flex items-center gap-2 text-success">
                <IconCheck className="h-5 w-5" />
                <h1 className="font-heading text-xl font-semibold text-foreground">Payment confirmed</h1>
              </div>
              <p className="text-sm text-foreground/80">
                You're subscribed to <strong>{status.plan.name || planName}</strong> ({status.billingInterval === "yearly" ? "annual" : "monthly"}).
                {status.status === "claimed" ? " Your account is already set up." : " Next, set up your account and restaurant."}
              </p>
              {status.status === "claimed" ? (
                <a href={`${ADMIN_URL}/login`} onClick={() => store(null)}>
                  <Button className="w-full">Sign in</Button>
                </a>
              ) : (
                setupUrl && (
                  <a href={setupUrl} onClick={() => store(null)}>
                    <Button className="w-full">Set up your account</Button>
                  </a>
                )
              )}
              {status.email && status.status !== "claimed" && (
                <p className="text-xs text-muted">We've also emailed a set-up link to {status.email}. Your receipt comes from Paddle, our payment provider.</p>
              )}
            </>
          )}
          {phase === "slow" && (
            <>
              <h1 className="font-heading text-xl font-semibold text-foreground">Your payment is being processed</h1>
              <p className="text-sm text-foreground/80">
                Confirmation is taking longer than usual. As soon as it arrives we'll email you a link to set up your account — you don't need to pay again.
              </p>
              <Button variant="secondary" onClick={() => { setPhase("confirming"); poll(); }}>
                Check again
              </Button>
            </>
          )}
        </Card>
      </Section>
    );
  }

  return (
    <Section>
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="font-heading text-3xl font-semibold text-foreground">Subscribe and pay now</h1>
          <p className="text-sm text-muted">
            No trial and no account needed first — pay securely, then set up your restaurant. Prefer to try it first?{" "}
            <Link to="/start-trial" className="underline">Start a free trial</Link>.
          </p>
        </div>

        <div role="radiogroup" aria-label="Billing period" className="mx-auto inline-flex rounded-full border border-border p-1 text-sm">
          {(["monthly", "yearly"] as const).map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={interval === i}
              onClick={() => setInterval(i)}
              className={`rounded-full px-4 py-1.5 font-medium ${interval === i ? "bg-primary text-primary-foreground" : "text-foreground/70"}`}
            >
              {i === "monthly" ? "Monthly" : "Annual (2 months free)"}
            </button>
          ))}
        </div>

        {error && <Alert tone="danger">{error}</Alert>}
        {plansError && (
          <Alert tone="danger">
            Plans couldn't load. <button type="button" className="underline" onClick={retry}>Try again</button>
          </Alert>
        )}
        {!plans && !plansError && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {ownerPlans.map((plan) => {
            const price = formatPlanPrice(plan.pricing, interval);
            return (
              <Card key={plan.code} className={`flex flex-col gap-4 ${selected === plan.code ? "ring-2 ring-primary" : ""}`}>
                <div className="flex flex-col gap-1">
                  <h2 className="font-heading text-xl font-semibold text-foreground">{plan.name}</h2>
                  {plan.description && <p className="text-sm text-muted">{plan.description}</p>}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-heading text-3xl font-semibold text-foreground">{price ?? "—"}</span>
                  {price && <span className="text-sm text-muted">/{interval === "monthly" ? "month" : "year"}</span>}
                </div>
                <Button
                  className="mt-auto w-full"
                  disabled={!price || phase === "starting" || phase === "paying"}
                  onClick={() => {
                    setSelected(plan.code);
                    void payNow(plan);
                  }}
                >
                  {phase === "starting" && selected === plan.code ? "Opening secure checkout…" : `Pay now — ${price ?? ""}`}
                </Button>
              </Card>
            );
          })}
        </div>

        <p className="text-center text-xs text-muted">
          Payments are processed by Paddle, our reseller and merchant of record. Prices exclude any tax added at checkout. You can cancel
          anytime. See our <Link to="/terms" className="underline">Terms</Link>, <Link to="/privacy" className="underline">Privacy Policy</Link> and{" "}
          <Link to="/refund-policy" className="underline">Refund Policy</Link>.
        </p>
      </div>
    </Section>
  );
}
