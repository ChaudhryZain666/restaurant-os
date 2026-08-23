import { useEffect, useState, type FormEvent } from "react";
import type { Promotion, PromotionType } from "@restaurant/types";
import { Alert, Badge, Button, Card, EmptyState } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLocation as useActiveLocation } from "../context/LocationContext";
import { IconTag } from "../components/icons";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

interface Draft {
  code: string;
  name: string;
  type: PromotionType;
  value: string;
  minOrderAmount: string;
  endDate: string;
  usageLimit: string;
  locationIds: string[];
}

function emptyDraft(): Draft {
  return { code: "", name: "", type: "percentage", value: "", minOrderAmount: "0", endDate: "", usageLimit: "", locationIds: [] };
}

function statusOf(promo: Promotion): { label: string; tone: "success" | "neutral" | "warning" | "danger" } {
  if (!promo.isActive) return { label: "Inactive", tone: "neutral" };
  if (promo.endDate && new Date(promo.endDate) < new Date()) return { label: "Expired", tone: "danger" };
  if (promo.usageLimit && promo.usageCount >= promo.usageLimit) return { label: "Limit reached", tone: "warning" };
  return { label: "Active", tone: "success" };
}

/**
 * Phase 23 — one promotion, owner-selected subset of the business's own locations. Shown only when
 * a business has more than one location (see Layout.tsx's nav gating); location-only promotions
 * keep working exactly as before, managed from the existing per-location PromotionsPage.tsx, which
 * now also shows (read-only) any business promotion targeting that location.
 */
export function BusinessPromotionsPage() {
  const { user } = useAuth();
  const businessId = user!.businessId!;
  const { locations } = useActiveLocation();

  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    const { promotions } = await apiClient.request<{ promotions: Promotion[] }>(`/businesses/${businessId}/promotions`);
    setPromotions(promotions);
  }

  useEffect(() => {
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  function toggleLocation(locationId: string) {
    setDraft((d) => ({
      ...d,
      locationIds: d.locationIds.includes(locationId) ? d.locationIds.filter((id) => id !== locationId) : [...d.locationIds, locationId],
    }));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (draft.locationIds.length === 0) {
      setError("Select at least one location");
      return;
    }
    setSaving(true);
    try {
      await apiClient.request(`/businesses/${businessId}/promotions`, {
        method: "POST",
        body: {
          code: draft.code,
          name: draft.name,
          type: draft.type,
          value: Number(draft.value),
          minOrderAmount: Number(draft.minOrderAmount) || 0,
          endDate: draft.endDate ? new Date(draft.endDate).toISOString() : undefined,
          usageLimit: draft.usageLimit ? Number(draft.usageLimit) : undefined,
          locationIds: draft.locationIds,
        },
      });
      setDraft(emptyDraft());
      setShowForm(false);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(promo: Promotion) {
    setError(null);
    setBusyId(promo.id);
    try {
      await apiClient.request(`/businesses/${businessId}/promotions/${promo.id}`, {
        method: "PATCH",
        body: { isActive: !promo.isActive },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(promo: Promotion) {
    if (!window.confirm(`Delete the promotion "${promo.name}"? This can't be undone.`)) return;
    setError(null);
    setBusyId(promo.id);
    try {
      await apiClient.request(`/businesses/${businessId}/promotions/${promo.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="text-muted">Loading promotions...</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Business Promotions</h1>
          <p className="text-sm text-muted">
            One code, applied at exactly the locations you select — never at any other location, even one of your
            own. Every code is validated and priced server-side.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New business promotion"}
        </Button>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {showForm && (
        <Card>
          <h2 className="mb-3 font-heading text-lg font-medium text-foreground">New business promotion</h2>
          <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Code
              <input
                required
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                placeholder="e.g. WEEKEND20"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input
                required
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Weekend 20% off"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Discount type
              <select
                value={draft.type}
                onChange={(e) => setDraft({ ...draft, type: e.target.value as PromotionType })}
                className={inputClass}
              >
                <option value="percentage">Percentage off</option>
                <option value="fixed">Fixed amount off</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {draft.type === "percentage" ? "Percentage (e.g. 10 = 10%)" : "Amount off"}
              <input
                required
                type="number"
                min="0"
                max={draft.type === "percentage" ? 100 : undefined}
                step="0.01"
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Minimum order amount
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.minOrderAmount}
                onChange={(e) => setDraft({ ...draft, minOrderAmount: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Usage limit (optional)
              <input
                type="number"
                min="1"
                value={draft.usageLimit}
                onChange={(e) => setDraft({ ...draft, usageLimit: e.target.value })}
                placeholder="Unlimited"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Expires (optional)
              <input
                type="date"
                value={draft.endDate}
                onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                className={`max-w-[10rem] ${inputClass}`}
              />
            </label>
            <fieldset className="flex flex-col gap-1.5 rounded-lg border border-border p-3 text-sm sm:col-span-2">
              <legend className="px-1 text-sm font-medium text-foreground">Locations</legend>
              {locations.map((loc) => (
                <label key={loc.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={draft.locationIds.includes(loc.id)} onChange={() => toggleLocation(loc.id)} />
                  {loc.name}
                </label>
              ))}
            </fieldset>
            <Button type="submit" size="sm" disabled={saving} className="self-start sm:col-span-2">
              {saving ? "Creating..." : "Create business promotion"}
            </Button>
          </form>
        </Card>
      )}

      {promotions.length === 0 ? (
        <EmptyState
          icon={<IconTag className="h-6 w-6" />}
          title="No business promotions yet"
          description="Create a code that applies across the locations you choose."
        />
      ) : (
        <Card>
          <ul className="flex flex-col divide-y divide-border">
            {promotions.map((promo) => {
              const status = statusOf(promo);
              const targetNames = (promo.locationIds ?? [])
                .map((id) => locations.find((l) => l.id === id)?.name ?? id)
                .join(", ");
              return (
                <li key={promo.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-[10rem] flex-1">
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary">
                        {promo.code}
                      </span>
                      {promo.name}
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </p>
                    <p className="text-xs text-muted">
                      {promo.type === "percentage" ? `${promo.value}% off` : `${promo.value} off`}
                      {" · "}
                      {promo.usageCount} use{promo.usageCount === 1 ? "" : "s"}
                      {promo.usageLimit ? ` of ${promo.usageLimit}` : ""}
                      {promo.endDate ? ` · expires ${new Date(promo.endDate).toLocaleDateString()}` : ""}
                      {" · "}
                      Applies at: {targetNames || "—"}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleActive(promo)}
                    disabled={busyId === promo.id}
                    className="text-sm font-medium text-foreground/70 hover:text-foreground hover:underline"
                  >
                    {promo.isActive ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    onClick={() => remove(promo)}
                    disabled={busyId === promo.id}
                    className="text-sm font-medium text-danger hover:underline"
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
