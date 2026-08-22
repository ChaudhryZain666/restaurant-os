import { useState, type FormEvent } from "react";
import type { Restaurant } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLocation as useActiveLocation } from "../context/LocationContext";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

const STATUS_TONE: Record<string, "success" | "neutral" | "danger"> = {
  active: "success",
  pending: "neutral",
  suspended: "danger",
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface Draft {
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  cloneFromLocationId: string;
}

function emptyDraft(): Draft {
  return { name: "", slug: "", timezone: "", currency: "", cloneFromLocationId: "" };
}

/**
 * Phase 19 — the owner-facing home for Business/Location management. Deliberately minimal at 1
 * location (just a summary + an "Add location" affordance) rather than presenting management
 * complexity nobody needs yet — see Section 5 of the phase brief this was built against. Reuses
 * CreateRestaurantPage.tsx's field pattern for the create form, but POSTs to the new, owner-scoped
 * POST /businesses/:businessId/locations (not POST /restaurants, which stays platform_admin-only).
 */
export function LocationsPage() {
  const { user } = useAuth();
  const { locations, activeLocationId, switchLocation, refetchLocations } = useActiveLocation();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [slugTouched, setSlugTouched] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Restaurant | null>(null);

  function updateName(name: string) {
    setDraft((d) => ({ ...d, name, slug: slugTouched ? d.slug : slugify(name) }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { restaurant } = await apiClient.request<{ restaurant: Restaurant }>(
        `/businesses/${user!.businessId}/locations`,
        {
          method: "POST",
          body: {
            name: draft.name,
            slug: draft.slug,
            timezone: draft.timezone || undefined,
            currency: draft.currency || undefined,
            cloneFromLocationId: draft.cloneFromLocationId || undefined,
          },
        }
      );
      await refetchLocations();
      setCreated(restaurant);
      setShowForm(false);
      setDraft(emptyDraft());
      setSlugTouched(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Locations</h1>
        <p className="text-sm text-muted">
          {locations.length <= 1
            ? "Every restaurant on this platform starts as a single location — add more here if you operate more than one."
            : "Every physical location under your business. Switch which one you're managing from the picker in the header."}
        </p>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {created && (
        <Alert tone="success">
          <strong>{created.name}</strong> was created. It starts <strong>pending</strong> — not visible to
          customers — until it's set up and published, same as any new restaurant.
        </Alert>
      )}

      {locations.length > 0 && (
        <Card className="p-0">
          <ul className="flex flex-col divide-y divide-border">
            {locations.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-[10rem] flex-1">
                  <p className="flex items-center gap-2 font-medium text-foreground">
                    {l.name}
                    {l.id === activeLocationId && <Badge tone="neutral">Active</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    {[l.address, l.city, l.country].filter(Boolean).join(", ") || l.slug}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[l.status] ?? "neutral"}>{l.status}</Badge>
                {l.id !== activeLocationId && (
                  <button
                    onClick={() => switchLocation(l.id)}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Switch to this location
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!showForm ? (
        <Button size="sm" onClick={() => setShowForm(true)} className="self-start">
          + Add another location
        </Button>
      ) : (
        <Card className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-medium text-foreground">New location</h2>
          <p className="text-xs text-muted">
            No new owner account is created — you already have access to every location under your business.
          </p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input required value={draft.name} onChange={(e) => updateName(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Slug
              <input
                required
                value={draft.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setDraft({ ...draft, slug: slugify(e.target.value) });
                }}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                className={inputClass}
              />
              <span className="text-xs text-muted">
                Storefront URL will be <code>/r/{draft.slug || "your-slug"}</code>.
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
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
            {locations.length > 0 && (
              <label className="flex flex-col gap-1 text-sm">
                Clone menu from (optional)
                <select
                  value={draft.cloneFromLocationId}
                  onChange={(e) => setDraft({ ...draft, cloneFromLocationId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Start with an empty menu</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted">
                  A one-time copy — the new location's menu is fully independent afterward, with no ongoing sync.
                </span>
              </label>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? "Creating..." : "Create location"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
