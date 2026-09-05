import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import type { Plan } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";

const inputClass = "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type Step = "plan" | "account" | "verify" | "business" | "review";

const STEP_ORDER: Step[] = ["plan", "account", "verify", "business", "review"];
const STEP_LABEL: Record<Step, string> = {
  plan: "Choose plan",
  account: "Create account",
  verify: "Verify email",
  business: "Your restaurant",
  review: "Review & start trial",
};

const DRAFT_KEY = "ownerSignupDraft";

interface Draft {
  selectedPlanCode: string;
  billingInterval: "monthly" | "yearly";
  restaurantName: string;
  restaurantSlug: string;
}

function loadDraft(): Partial<Draft> {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<Draft>) : {};
  } catch {
    return {};
  }
}

function saveDraft(draft: Draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // best-effort only — a lost draft just means re-typing a couple of fields
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

function formatPrice(pricing: Plan["pricing"], interval: "monthly" | "yearly"): string | null {
  const entry = pricing.find((p) => p.interval === interval);
  if (!entry?.amountCents || !entry.currency) return null;
  const amount = (entry.amountCents / 100).toLocaleString(undefined, { style: "currency", currency: entry.currency });
  return `${amount}/${interval === "monthly" ? "mo" : "yr"}`;
}

/**
 * Phase 44 — the real "an independent restaurant owner starts their own trial" flow, the owner
 * counterpart to AgencySignupWizardPage. Sequences existing, UNMODIFIED endpoints in the order the
 * backend actually requires them:
 *   POST /auth/register          -> account exists, unverified, already logged in
 *   POST /auth/verify-email      -> required before self-serve business creation will accept this
 *                                    caller (business.controller.ts's createBusinessSelfServe
 *                                    rejects an unverified caller with 403 — Phase 37, tested in
 *                                    business.controller.test.ts) — this wizard does not, and must
 *                                    not, skip or fake this step
 *   POST /businesses/self-serve  -> creates the Business + first Restaurant, makes caller its owner
 *   POST /businesses/:id/subscription -> starts the actual no-card trial on the chosen plan
 *
 * Resumable across a reload/new-tab (e.g. the verification link opens in a fresh tab of the same
 * browser): on mount, the step is re-derived from the account's REAL state — never assumed —
 * using whatever session the refresh cookie already establishes, plus a small sessionStorage
 * draft of the plan/restaurant-name fields (never anything server-authoritative) so those aren't
 * lost across that reload. A caller who already has a businessId (finished this before, or was
 * provisioned some other way) is sent straight into the product — this screen has nothing left to
 * do for them.
 */
export function OwnerSignupWizardPage() {
  const { user, loading: authLoading, register, refreshUser } = useAuth();
  const navigate = useNavigate();

  const draft = loadDraft();
  const [step, setStep] = useState<Step>("plan");
  const [resolved, setResolved] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedPlanCode, setSelectedPlanCode] = useState(draft.selectedPlanCode ?? "");
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">(draft.billingInterval ?? "monthly");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [restaurantName, setRestaurantName] = useState(draft.restaurantName ?? "");
  const [restaurantSlug, setRestaurantSlug] = useState(draft.restaurantSlug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .request<{ plans: Plan[] }>("/public/plans")
      .then((res) => {
        // Real production plans always carry real pricing (planCatalogSeed.service.ts) — a
        // type:"OWNER" plan with no priced interval at all can only be stray test-fixture data
        // (this dev database has some, e.g. leftover Jest "Test Plan" documents left isActive:true)
        // and would leave a customer unable to see a real price or start a real trial, so it's
        // filtered out here rather than trusted alongside the real catalog.
        const ownerPlans = res.plans
          .filter((p) => p.type === "OWNER" && p.pricing.some((price) => price.amountCents > 0))
          .sort((a, b) => (a.pricing.find((x) => x.interval === "monthly")?.amountCents ?? 0) - (b.pricing.find((x) => x.interval === "monthly")?.amountCents ?? 0));
        setPlans(ownerPlans);
        setSelectedPlanCode((prev) => prev || ownerPlans[0]?.code || "");
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setPlansLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-derive the real starting step once auth has resolved — never trust an assumption about
  // where the user "should" be. See the component doc comment above.
  useEffect(() => {
    if (authLoading || resolved) return;
    if (user?.businessId) {
      navigate("/", { replace: true });
      return;
    }
    if (user && !user.emailVerified) {
      setStep("verify");
    } else if (user) {
      setStep("business");
    }
    setResolved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, resolved]);

  useEffect(() => {
    saveDraft({ selectedPlanCode, billingInterval, restaurantName, restaurantSlug });
  }, [selectedPlanCode, billingInterval, restaurantName, restaurantSlug]);

  const selectedPlan = plans.find((p) => p.code === selectedPlanCode);

  function goNext(next: Step) {
    setError(null);
    setNotice(null);
    setStep(next);
  }

  async function handleAccountSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(name, email, password);
      goNext("verify");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckVerified() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const fresh = await refreshUser();
      if (fresh?.emailVerified) {
        goNext("business");
      } else {
        setError("We haven't seen that verification yet — check your inbox (and spam folder) for the link, then try again.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiClient.request<{ message: string }>("/auth/resend-verification", { method: "POST" });
      setNotice(res.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleBusinessSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { business } = await apiClient.request<{ business: { id: string } }>("/businesses/self-serve", {
        method: "POST",
        body: { name: restaurantName, slug: restaurantSlug },
      });
      // The JWT still reflects the pre-creation role/businessId — refresh before the subscription
      // call below needs the new businessId to actually be usable (same contract as the agency
      // wizard's own handleAgencySubmit).
      await refreshUser();
      setBusinessId(business.id);
      goNext("review");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStartTrial() {
    if (!businessId) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.request(`/businesses/${businessId}/subscription`, {
        method: "POST",
        body: { planCode: selectedPlanCode, billingInterval },
      });
      clearDraft();
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-lg animate-scale-in">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary font-heading text-base font-bold text-primary-foreground">
            T
          </span>
          <span className="font-heading text-lg font-semibold text-foreground">Tablecloth</span>
        </div>

        <ol className="mb-6 flex flex-wrap gap-2 text-xs text-muted">
          {STEP_ORDER.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                  s === step ? "bg-primary text-primary-foreground" : STEP_ORDER.indexOf(step) > i ? "bg-success/20 text-success" : "bg-border text-muted"
                }`}
              >
                {i + 1}
              </span>
              {STEP_LABEL[s]}
              {i < STEP_ORDER.length - 1 && <span className="text-border">→</span>}
            </li>
          ))}
        </ol>

        {error && (
          <Alert tone="danger" role="alert" className="mb-4">
            {error}
          </Alert>
        )}
        {notice && (
          <Alert tone="success" role="status" className="mb-4">
            {notice}
          </Alert>
        )}

        {step === "plan" && (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="font-heading text-xl font-semibold text-foreground">Start your free trial</h1>
              <p className="text-sm text-muted">14 days, no credit card required. Cancel anytime during the trial.</p>
            </div>
            {plansLoading ? (
              <p className="text-sm text-muted">Loading plans...</p>
            ) : (
              <div className="flex flex-col gap-2">
                {plans.map((p) => (
                  <label
                    key={p.code}
                    className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm ${
                      selectedPlanCode === p.code ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <span className="flex items-center justify-between">
                      <span className="flex items-center gap-2 font-medium text-foreground">
                        <input
                          type="radio"
                          name="plan"
                          checked={selectedPlanCode === p.code}
                          onChange={() => setSelectedPlanCode(p.code)}
                        />
                        {p.name}
                      </span>
                      <span className="text-muted">{formatPrice(p.pricing, billingInterval) ?? "Contact us"}</span>
                    </span>
                    {p.description && <span className="pl-6 text-xs text-muted">{p.description}</span>}
                  </label>
                ))}
                <label className="mt-2 flex items-center gap-2 text-sm">
                  Billing interval
                  <select
                    value={billingInterval}
                    onChange={(e) => setBillingInterval(e.target.value as "monthly" | "yearly")}
                    className={inputClass}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </label>
              </div>
            )}
            <Button disabled={!selectedPlanCode} onClick={() => goNext("account")} className="w-full">
              Continue
            </Button>
            <p className="text-center text-xs text-muted">
              Already have an account?{" "}
              <Link to="/login" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        )}

        {step === "account" && (
          <form onSubmit={handleAccountSubmit} className="flex flex-col gap-4">
            <div>
              <h1 className="font-heading text-xl font-semibold text-foreground">Create your account</h1>
              <p className="text-sm text-muted">This is your own login for managing your restaurant.</p>
            </div>
            <label className="flex flex-col gap-1 text-sm text-foreground">
              Full name
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-foreground">
              Email
              <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} required />
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
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Creating account..." : "Continue"}
            </Button>
          </form>
        )}

        {step === "verify" && (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="font-heading text-xl font-semibold text-foreground">Check your email</h1>
              <p className="text-sm text-muted">
                We sent a verification link to <span className="font-medium text-foreground">{user?.email ?? "your email address"}</span>.
                Click it, then come back here and continue.
              </p>
            </div>
            <Button onClick={handleCheckVerified} disabled={busy} className="w-full">
              {busy ? "Checking..." : "I've verified my email — continue"}
            </Button>
            <Button variant="outline" onClick={handleResend} disabled={busy} className="w-full">
              Resend verification email
            </Button>
          </div>
        )}

        {step === "business" && (
          <form onSubmit={handleBusinessSubmit} className="flex flex-col gap-4">
            <div>
              <h1 className="font-heading text-xl font-semibold text-foreground">Tell us about your restaurant</h1>
              <p className="text-sm text-muted">This becomes your storefront's web address — you can add everything else after.</p>
            </div>
            <label className="flex flex-col gap-1 text-sm text-foreground">
              Restaurant name
              <input
                className={inputClass}
                value={restaurantName}
                onChange={(e) => {
                  setRestaurantName(e.target.value);
                  if (!slugTouched) setRestaurantSlug(slugify(e.target.value));
                }}
                required
                minLength={2}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-foreground">
              Web address
              <input
                className={inputClass}
                value={restaurantSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setRestaurantSlug(slugify(e.target.value));
                }}
                placeholder="my-restaurant"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                required
              />
            </label>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Creating your restaurant..." : "Continue"}
            </Button>
          </form>
        )}

        {step === "review" && selectedPlan && (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="font-heading text-xl font-semibold text-foreground">Review & start your trial</h1>
            </div>
            <dl className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Plan</dt>
                <dd className="font-medium text-foreground">{selectedPlan.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Billing</dt>
                <dd className="text-foreground">
                  {formatPrice(selectedPlan.pricing, billingInterval) ?? "Contact us"} ({billingInterval})
                </dd>
              </div>
              {selectedPlan.trialDays && (
                <div className="flex justify-between">
                  <dt className="text-muted">Trial length</dt>
                  <dd className="text-foreground">{selectedPlan.trialDays} days, no card required</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted">After your trial ends</dt>
                <dd className="text-foreground">
                  You'll be billed {formatPrice(selectedPlan.pricing, billingInterval) ?? "the plan price"} unless you cancel first.
                </dd>
              </div>
            </dl>
            <Badge tone="success" className="w-fit">
              No card required until your trial ends
            </Badge>
            <Button onClick={handleStartTrial} disabled={busy} className="w-full">
              {busy ? "Starting trial..." : selectedPlan.trialDays ? `Start ${selectedPlan.trialDays}-day trial` : "Start subscription"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
