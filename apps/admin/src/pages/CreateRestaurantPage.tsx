import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Restaurant } from "@restaurant/types";
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

interface Draft {
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  ownerName: string;
  ownerEmail: string;
}

function emptyDraft(): Draft {
  return { name: "", slug: "", timezone: "", currency: "", ownerName: "", ownerEmail: "" };
}

/**
 * Phase 14 — the platform-admin "Create Restaurant" workflow the Phase 13 audit found entirely
 * missing: POST /restaurants existed but no page ever called it, and its old ownerId-based shape
 * had no UI path to create that owner in the first place. This form collects both the restaurant
 * and its first owner in one submission; the backend provisions them atomically and emails the
 * owner an invite (see restaurant.controller.ts's createRestaurant / auth.controller.ts's
 * acceptInvite, the same flow staff invites already use).
 */
export function CreateRestaurantPage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [slugTouched, setSlugTouched] = useState(false);
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
      const { restaurant } = await apiClient.request<{ restaurant: Restaurant }>("/restaurants", {
        method: "POST",
        body: {
          name: draft.name,
          slug: draft.slug,
          timezone: draft.timezone || undefined,
          currency: draft.currency || undefined,
          owner: { name: draft.ownerName, email: draft.ownerEmail },
        },
      });
      setCreated(restaurant);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Restaurant created</h1>
        <Alert tone="success">
          <strong>{created.name}</strong> was created and an invitation was sent to{" "}
          <strong>{draft.ownerEmail}</strong>. It stays <strong>pending</strong> — not visible to customers — until
          the owner finishes setup and publishes it.
        </Alert>
        <div className="flex gap-3">
          <Button onClick={() => navigate("/platform/restaurants")}>Back to Restaurants</Button>
          <Button
            variant="ghost"
            onClick={() => {
              setCreated(null);
              setDraft(emptyDraft());
              setSlugTouched(false);
            }}
          >
            Create another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <Link to="/platform/restaurants" className="text-sm font-medium text-primary hover:underline">
          ← Restaurants
        </Link>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Create restaurant</h1>
        <p className="text-sm text-muted">
          Provisions the restaurant and invites its first owner. The restaurant starts pending — it won't be
          visible to customers until the owner completes setup and publishes it.
        </p>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-medium text-foreground">Restaurant</h2>
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
              Storefront URL will be <code>/r/{draft.slug || "your-slug"}</code>. Lowercase letters, numbers, and
              hyphens only.
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
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-medium text-foreground">Owner</h2>
          <p className="text-xs text-muted">
            They'll get an email inviting them to set their own password — no password to share with them yourself.
          </p>
          <label className="flex flex-col gap-1 text-sm">
            Full name
            <input
              required
              value={draft.ownerName}
              onChange={(e) => setDraft({ ...draft, ownerName: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              type="email"
              required
              value={draft.ownerEmail}
              onChange={(e) => setDraft({ ...draft, ownerEmail: e.target.value })}
              className={inputClass}
            />
          </label>
        </Card>

        <Button type="submit" disabled={submitting} className="self-start">
          {submitting ? "Creating..." : "Create restaurant & send invite"}
        </Button>
      </form>
    </div>
  );
}
