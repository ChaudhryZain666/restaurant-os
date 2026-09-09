import { useEffect, useState, type FormEvent } from "react";
import type { Plan } from "@restaurant/types";
import { Alert, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatPrice(amountCents: number, currency: string): string {
  return (amountCents / 100).toLocaleString(undefined, { style: "currency", currency });
}

type Step = "client" | "restaurant" | "commercial" | "owner" | "review";
const STEP_ORDER: Step[] = ["client", "restaurant", "commercial", "owner", "review"];
const STEP_LABEL: Record<Step, string> = {
  client: "Client",
  restaurant: "Restaurant",
  commercial: "Commercial",
  owner: "Owner access",
  review: "Review",
};

type ProvisioningMode = "invite" | "direct";

interface Draft {
  businessName: string;
  businessSlug: string;
  ownerName: string;
  ownerEmail: string;
  locationName: string;
  locationSlug: string;
  timezone: string;
  currency: string;
  planLabel: string;
  priceDollars: string;
  billingCycle: "monthly" | "yearly";
  isTrial: boolean;
}

function emptyDraft(): Draft {
  return {
    businessName: "",
    businessSlug: "",
    ownerName: "",
    ownerEmail: "",
    locationName: "",
    locationSlug: "",
    timezone: "",
    currency: "",
    planLabel: "",
    priceDollars: "",
    billingCycle: "monthly",
    isTrial: false,
  };
}

interface CreateClientResult {
  businessId: string;
  ownerTemporaryPassword?: string;
  ownerEmail: string;
  commercialTermsError?: string;
}

/**
 * Phase 59, Section 5 — a guided Client -> Restaurant -> Commercial -> Owner -> Review flow over
 * the SAME atomic backend call Phase 25/28 already established (POST /agencies/:id/businesses
 * creates the owner User + Business + first Restaurant transactionally — see
 * agency.controller.ts's createAgencyBusiness). Only the Commercial step is genuinely new (Phase 59
 * Section 2): it's a deliberately SEPARATE, best-effort, non-atomic follow-up call
 * (PUT .../commercial-terms) — if it fails after the client was created, that's surfaced honestly
 * (never a fake success, never rolled back), since it's an informational agency<->client agreement
 * record, not part of core account provisioning. See ClientCommercialTerms.ts's doc comment for the
 * full boundary this enforces (never a payment-collection system, never affects real entitlements).
 */
export function ClientProvisioningWizard({
  agencyId,
  atBusinessLimit,
  onCreated,
  onCancel,
}: {
  agencyId: string;
  atBusinessLimit: boolean;
  onCreated: (result: CreateClientResult) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>("client");
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [slugTouched, setSlugTouched] = useState(false);
  const [locationSlugTouched, setLocationSlugTouched] = useState(false);
  const [provisioningMode, setProvisioningMode] = useState<ProvisioningMode>("invite");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .request<{ plans: Plan[] }>("/public/plans")
      .then((res) => setPlans(res.plans.filter((p) => p.type === "OWNER" && p.isActive)))
      .catch(() => setPlans([])); // the wizard still works with a free-text plan label if this fails
  }, []);

  const stepIndex = STEP_ORDER.indexOf(step);

  function goNext() {
    setError(null);
    if (step === "client" && (!draft.businessName || !draft.businessSlug || !draft.ownerName || !draft.ownerEmail)) {
      setError("Fill in the client's name, slug, and owner details before continuing.");
      return;
    }
    if (step === "restaurant" && (!draft.locationName || !draft.locationSlug)) {
      setError("Fill in the first location's name and slug before continuing.");
      return;
    }
    setStep(STEP_ORDER[Math.min(stepIndex + 1, STEP_ORDER.length - 1)]);
  }
  function goBack() {
    setError(null);
    setStep(STEP_ORDER[Math.max(stepIndex - 1, 0)]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const result = await apiClient.request<{
        business: { id: string; ownerId?: string };
        ownerTemporaryPassword?: string;
      }>(`/agencies/${agencyId}/businesses`, {
        method: "POST",
        body: {
          businessName: draft.businessName,
          businessSlug: draft.businessSlug,
          ownerName: draft.ownerName,
          ownerEmail: draft.ownerEmail,
          locationName: draft.locationName,
          locationSlug: draft.locationSlug,
          timezone: draft.timezone || undefined,
          currency: draft.currency || undefined,
          provisioningMode,
        },
      });
      const businessId = result.business.id;

      let commercialTermsError: string | undefined;
      const priceCents = draft.priceDollars ? Math.round(Number(draft.priceDollars) * 100) : undefined;
      if (draft.planLabel || priceCents !== undefined) {
        try {
          await apiClient.request(`/agencies/${agencyId}/businesses/${businessId}/commercial-terms`, {
            method: "PUT",
            body: {
              planLabel: draft.planLabel || undefined,
              priceAmountCents: priceCents,
              currency: draft.currency || "USD",
              billingCycle: draft.billingCycle,
              status: draft.isTrial ? "trial" : "active",
            },
          });
        } catch (err) {
          // Never silently claim success, and never block the (already-real) client creation on
          // this best-effort follow-up — see the component doc comment above.
          commercialTermsError = (err as Error).message;
        }
      }

      onCreated({ businessId, ownerTemporaryPassword: result.ownerTemporaryPassword, ownerEmail: draft.ownerEmail, commercialTermsError });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-medium text-foreground">Create a client</h2>
        <button type="button" onClick={onCancel} className="text-sm font-medium text-muted hover:text-foreground">
          Cancel
        </button>
      </div>

      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
        {STEP_ORDER.map((s, i) => (
          <li key={s} className={`flex items-center gap-1.5 ${i === stepIndex ? "font-medium text-foreground" : "text-muted"}`}>
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                i < stepIndex ? "bg-success/20 text-success" : i === stepIndex ? "bg-primary/15 text-primary" : "bg-black/[0.05]"
              }`}
            >
              {i + 1}
            </span>
            {STEP_LABEL[s]}
            {i < STEP_ORDER.length - 1 && <span className="text-muted">→</span>}
          </li>
        ))}
      </ol>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {step === "client" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Business name
              <input
                required
                value={draft.businessName}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, businessName: e.target.value, businessSlug: slugTouched ? d.businessSlug : slugify(e.target.value) }))
                }
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Business slug
              <input
                required
                value={draft.businessSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setDraft({ ...draft, businessSlug: slugify(e.target.value) });
                }}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Owner full name
              <input required value={draft.ownerName} onChange={(e) => setDraft({ ...draft, ownerName: e.target.value })} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Owner email
              <input
                required
                type="email"
                value={draft.ownerEmail}
                onChange={(e) => setDraft({ ...draft, ownerEmail: e.target.value })}
                className={inputClass}
              />
            </label>
          </div>
        )}

        {step === "restaurant" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              First location name
              <input
                required
                value={draft.locationName}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    locationName: e.target.value,
                    locationSlug: locationSlugTouched ? d.locationSlug : slugify(e.target.value),
                  }))
                }
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Location slug
              <input
                required
                value={draft.locationSlug}
                onChange={(e) => {
                  setLocationSlugTouched(true);
                  setDraft({ ...draft, locationSlug: slugify(e.target.value) });
                }}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Timezone (optional)
              <input
                value={draft.timezone}
                onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
                placeholder="e.g. America/New_York"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Currency (optional)
              <input
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })}
                placeholder="USD"
                maxLength={3}
                className={inputClass}
              />
            </label>
          </div>
        )}

        {step === "commercial" && (
          <div className="flex flex-col gap-3">
            <Alert tone="neutral">
              This records what YOUR agency charges this client for your services — it is not collected by the
              platform, and it never changes what the platform charges you. Leave it blank to configure later.
            </Alert>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                Plan / tier label (optional)
                <select
                  value={draft.planLabel}
                  onChange={(e) => setDraft({ ...draft, planLabel: e.target.value })}
                  className={inputClass}
                >
                  <option value="">No plan label</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Client price (optional)
                <div className="flex items-center gap-1.5">
                  <span className="text-muted">{draft.currency || "USD"}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.priceDollars}
                    onChange={(e) => setDraft({ ...draft, priceDollars: e.target.value })}
                    placeholder="99.00"
                    className={inputClass + " flex-1"}
                  />
                </div>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Billing cycle
                <select
                  value={draft.billingCycle}
                  onChange={(e) => setDraft({ ...draft, billingCycle: e.target.value as "monthly" | "yearly" })}
                  className={inputClass}
                >
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.isTrial} onChange={(e) => setDraft({ ...draft, isTrial: e.target.checked })} />
                This client is in a trial period
              </label>
            </div>
          </div>
        )}

        {step === "owner" && (
          <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm sm:flex-row sm:gap-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted">Owner access</legend>
            <label className="flex items-start gap-2">
              <input type="radio" checked={provisioningMode === "invite"} onChange={() => setProvisioningMode("invite")} className="mt-0.5" />
              <span>
                <span className="font-medium text-foreground">Send invitation</span>
                <br />
                <span className="text-muted">Email the owner a secure link to set their own password.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" checked={provisioningMode === "direct"} onChange={() => setProvisioningMode("direct")} className="mt-0.5" />
              <span>
                <span className="font-medium text-foreground">Create owner access now</span>
                <br />
                <span className="text-muted">
                  Get a one-time temporary password to relay to the owner directly. They must set their own password
                  before using the account.
                </span>
              </span>
            </label>
          </fieldset>
        )}

        {step === "review" && (
          <dl className="grid gap-x-4 gap-y-2 rounded-lg border border-border p-3 text-sm sm:grid-cols-2">
            <dt className="text-muted">Client</dt>
            <dd className="font-medium text-foreground">{draft.businessName || "—"}</dd>
            <dt className="text-muted">Restaurant</dt>
            <dd className="font-medium text-foreground">{draft.locationName || "—"}</dd>
            <dt className="text-muted">Owner</dt>
            <dd className="font-medium text-foreground">{draft.ownerEmail || "—"}</dd>
            <dt className="text-muted">Owner access</dt>
            <dd className="text-foreground">{provisioningMode === "invite" ? "Email invitation" : "Direct access (temporary password)"}</dd>
            <dt className="text-muted">Plan</dt>
            <dd className="text-foreground">{draft.planLabel || "Not configured"}</dd>
            <dt className="text-muted">Client price</dt>
            <dd className="text-foreground">
              {draft.priceDollars ? `${formatPrice(Math.round(Number(draft.priceDollars) * 100), draft.currency || "USD")}/${draft.billingCycle === "monthly" ? "mo" : "yr"}` : "Not configured"}
            </dd>
          </dl>
        )}

        <div className="flex items-center gap-2">
          {stepIndex > 0 && (
            <Button type="button" size="sm" variant="secondary" onClick={goBack}>
              Back
            </Button>
          )}
          {step !== "review" ? (
            <Button key="next" type="button" size="sm" onClick={goNext}>
              Next
            </Button>
          ) : (
            <Button key="submit" type="submit" size="sm" disabled={creating || atBusinessLimit}>
              {creating ? "Creating..." : "Create client"}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
