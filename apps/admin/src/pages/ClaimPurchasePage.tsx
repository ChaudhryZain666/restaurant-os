import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiClientError } from "@restaurant/utils";
import { Alert, Button, Card, Logo, Spinner } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { LegalConsentCheckbox } from "../components/LegalConsentCheckbox";
import { browserTimezone, slugify } from "./OwnerSignupWizardPage";

/**
 * Launch, 2026-11-21 — set up the account for a purchase made on the public pay-now checkout
 * (garnishtable.com/checkout). Reached from that page or from the emailed link, with the one-time
 * token in the URL FRAGMENT (#token=…), which browsers never send to a server. The token is kept in
 * sessionStorage so a detour through sign-in comes back here.
 */

const inputClass = "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";
const STORAGE_KEY = "garnishtable.claimToken";

interface ClaimStatus {
  status: "open" | "paid" | "claimed";
  plan: { code: string; name: string };
  billingInterval: "monthly" | "yearly";
  email: string | null;
  emailHasAccount: boolean;
}

function readToken(): string | null {
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
  try {
    if (fromHash) {
      sessionStorage.setItem(STORAGE_KEY, fromHash);
      // Drop the token from the address bar (and so from history and screenshots).
      window.history.replaceState(null, "", window.location.pathname);
      return fromHash;
    }
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return fromHash;
  }
}

export function ClaimPurchasePage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, refreshUser } = useAuth();
  const [token] = useState(readToken);
  const [status, setStatus] = useState<ClaimStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: number | undefined;
    const load = (attempt = 0) =>
      apiClient
        .request<ClaimStatus>("/public/checkout/status", { method: "POST", body: { token }, skipRefresh: true })
        .then((s) => {
          if (cancelled) return;
          setStatus(s);
          // The payment webhook can land a few seconds after the buyer gets here.
          if (s.status === "open" && attempt < 40) timer = window.setTimeout(() => load(attempt + 1), 3000);
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [token]);

  const restaurantBody = () => ({ name: restaurantName, slug, timezone: browserTimezone() });

  async function finish(accessToken: string) {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    apiClient.setAccessToken(accessToken);
    await refreshUser();
    navigate("/", { replace: true });
  }

  async function handleNewAccount(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.request<{ accessToken: string }>("/public/checkout/claim", {
        method: "POST",
        body: { token, name, password, termsAccepted: true, restaurant: restaurantBody() },
        skipRefresh: true,
      });
      await finish(res.accessToken);
    } catch (err) {
      if (err instanceof ApiClientError && (err.details as { reason?: string } | undefined)?.reason === "email_has_account") {
        setStatus((s) => (s ? { ...s, emailHasAccount: true } : s));
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSignedIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.request<{ accessToken: string }>("/public/checkout/claim/signed-in", {
        method: "POST",
        body: { token, ...(user?.businessId ? {} : { restaurant: restaurantBody(), termsAccepted: true }) },
      });
      await finish(res.accessToken);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const restaurantFields = (
    <>
      <label className="flex flex-col gap-1 text-sm text-foreground">
        Restaurant name
        <input
          className={inputClass}
          value={restaurantName}
          onChange={(e) => {
            setRestaurantName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          required
          minLength={2}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-foreground">
        Web address
        <input
          className={inputClass}
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(slugify(e.target.value));
          }}
          placeholder="my-restaurant"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          required
        />
      </label>
    </>
  );

  let body: React.ReactNode;
  if (!token) {
    body = (
      <Alert tone="danger">
        This set-up link is incomplete. Open the link from your payment confirmation email, or contact us.
      </Alert>
    );
  } else if (!status && !error) {
    body = (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  } else if (!status) {
    body = <Alert tone="danger">{error}</Alert>;
  } else if (status.status === "open") {
    body = (
      <div className="flex items-center gap-3">
        <Spinner />
        <p className="text-sm text-muted">We're confirming your payment. This page continues by itself in a few seconds.</p>
      </div>
    );
  } else if (status.status === "claimed") {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-foreground/80">This purchase is already set up.</p>
        <Link to="/login">
          <Button className="w-full">Sign in</Button>
        </Link>
      </div>
    );
  } else if (status.emailHasAccount) {
    const sameAccount = user && status.email && user.email.toLowerCase() === status.email.toLowerCase();
    body = authLoading ? (
      <Spinner />
    ) : user ? (
      <form onSubmit={handleSignedIn} className="flex flex-col gap-4">
        <p className="text-sm text-foreground/80">
          Add <strong>{status.plan.name}</strong> to the account you're signed in to ({user.email}).
          {!sameAccount && " That's not the email used at checkout — check it's the account you want."}
        </p>
        {!user.businessId && restaurantFields}
        {!user.businessId && <LegalConsentCheckbox checked={termsAccepted} onChange={setTermsAccepted} />}
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" disabled={busy || (!user.businessId && !termsAccepted)} className="w-full">
          {busy ? "Adding your plan..." : "Add plan to my account"}
        </Button>
      </form>
    ) : (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-foreground/80">
          {status.email} already has a GarnishTable account. Sign in, and you'll come back here to add your plan to it.
        </p>
        <Link to="/login" state={{ from: "/claim" }}>
          <Button className="w-full">Sign in to continue</Button>
        </Link>
      </div>
    );
  } else {
    body = (
      <form onSubmit={handleNewAccount} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-foreground">
          Email
          <input className={inputClass} value={status.email ?? ""} readOnly aria-readonly="true" />
          <span className="text-xs text-muted">The email you paid with. You'll sign in with it.</span>
        </label>
        <label className="flex flex-col gap-1 text-sm text-foreground">
          Full name
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required minLength={1} autoComplete="name" />
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
        {restaurantFields}
        <LegalConsentCheckbox checked={termsAccepted} onChange={setTermsAccepted} />
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" disabled={busy || !termsAccepted} className="w-full">
          {busy ? "Setting up your account..." : "Create my account"}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-lg animate-scale-in">
        <div className="mb-5">
          <Logo />
        </div>
        <div className="mb-4">
          <h1 className="font-heading text-xl font-semibold text-foreground">Set up your account</h1>
          {status && status.status !== "open" && (
            <p className="text-sm text-muted">
              Paid: {status.plan.name}, {status.billingInterval === "yearly" ? "billed annually" : "billed monthly"}.
            </p>
          )}
        </div>
        {body}
      </Card>
    </div>
  );
}
