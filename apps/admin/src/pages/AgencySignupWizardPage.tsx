import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import type { Plan } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useAgency } from "../context/AgencyContext";

const inputClass = "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";

type Step = "plan" | "account" | "agency" | "review";

const STEP_ORDER: Step[] = ["plan", "account", "agency", "review"];
const STEP_LABEL: Record<Step, string> = {
  plan: "Choose plan",
  account: "Create account",
  agency: "Agency info",
  review: "Review & start trial",
};

function formatPrice(pricing: Plan["pricing"], interval: "monthly" | "yearly"): string | null {
  const entry = pricing.find((p) => p.interval === interval);
  if (!entry?.amountCents || !entry.currency) return null;
  const amount = (entry.amountCents / 100).toLocaleString(undefined, { style: "currency", currency: entry.currency });
  return `${amount}/${interval === "monthly" ? "mo" : "yr"}`;
}

/**
 * Phase 28 — the agency's real "Choose Plan -> Create Account -> Agency Info -> Review -> Start
 * Trial" commercial flow. Deliberately built ONLY for agency self-serve signup — it's the only
 * account-creation path that structurally starts with "create account" (see RegisterPage.tsx's own
 * doc comment: every other admin identity is always invited). Sequences existing, UNMODIFIED
 * endpoints in order — no new subscription logic, no new account-creation logic, just a real
 * plan-first sequence instead of the old disconnected "register -> create agency -> stumble onto
 * /billing later" path. RegisterPage.tsx itself stays exactly as it was (e2e/agency-management.spec.ts
 * still exercises it directly) — this is a new, additional entry point, not a replacement.
 */
export function AgencySignupWizardPage() {
  const { register, refreshUser } = useAuth();
  const { refetchAgencies } = useAgency();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("plan");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedPlanCode, setSelectedPlanCode] = useState("");
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [agencyName, setAgencyName] = useState("");
  const [agencySlug, setAgencySlug] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [agencyId, setAgencyId] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .request<{ plans: Plan[] }>("/public/plans")
      .then((res) => {
        const agencyPlans = res.plans.filter((p) => p.type === "AGENCY");
        setPlans(agencyPlans);
        if (agencyPlans[0]) setSelectedPlanCode(agencyPlans[0].code);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setPlansLoading(false));
  }, []);

  const selectedPlan = plans.find((p) => p.code === selectedPlanCode);

  function goNext(next: Step) {
    setError(null);
    setStep(next);
  }

  async function handleAccountSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(name, email, password);
      setContactEmail((prev) => prev || email);
      goNext("agency");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAgencySubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { agency } = await apiClient.request<{ agency: { id: string } }>("/agencies", {
        method: "POST",
        body: { name: agencyName, slug: agencySlug, contactEmail },
      });
      // The JWT still reflects the pre-creation role/agencyMemberships — refresh before the new
      // agency is usable for the subscription call below (same contract createAgency's own doc
      // comment describes).
      await refreshUser();
      await refetchAgencies();
      setAgencyId(agency.id);
      goNext("review");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStartTrial() {
    if (!agencyId) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.request(`/agencies/${agencyId}/subscription`, {
        method: "POST",
        body: { planCode: selectedPlanCode, billingInterval },
      });
      navigate("/agency", { replace: true });
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
          <span className="font-heading text-lg font-semibold text-foreground">Tablecloth for Agencies</span>
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

        {step === "plan" && (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="font-heading text-xl font-semibold text-foreground">Choose your plan</h1>
              <p className="text-sm text-muted">You won't be charged until your trial ends.</p>
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
              <p className="text-sm text-muted">This is your own login — you'll invite team members afterward.</p>
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

        {step === "agency" && (
          <form onSubmit={handleAgencySubmit} className="flex flex-col gap-4">
            <div>
              <h1 className="font-heading text-xl font-semibold text-foreground">Tell us about your agency</h1>
            </div>
            <label className="flex flex-col gap-1 text-sm text-foreground">
              Agency name
              <input className={inputClass} value={agencyName} onChange={(e) => setAgencyName(e.target.value)} required minLength={2} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-foreground">
              Slug
              <input
                className={inputClass}
                value={agencySlug}
                onChange={(e) => setAgencySlug(e.target.value.toLowerCase())}
                placeholder="my-agency"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-foreground">
              Contact email
              <input
                type="email"
                className={inputClass}
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                required
              />
            </label>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Creating agency..." : "Continue"}
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
