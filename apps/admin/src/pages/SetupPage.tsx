import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Restaurant, RestaurantReadiness, SetupChecklistItem } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";
import { previewUrl, storefrontUrl } from "../lib/links";

const CHECK_LINKS: Record<string, { label: string; to: string }> = {
  profile: { label: "Restaurant profile", to: "/settings" },
  menu: { label: "Menu", to: "/menu" },
  orderType: { label: "Ordering & delivery", to: "/delivery" },
  location: { label: "Location", to: "/settings" },
};

const EXTENDED_LINKS: Record<string, { label: string; to: string }> = {
  branding: { label: "Storefront", to: "/settings" },
  hours: { label: "Business hours", to: "/settings" },
  tables: { label: "Tables", to: "/tables" },
  kitchen: { label: "Kitchen", to: "/kitchen" },
  staff: { label: "Staff", to: "/staff" },
  loyalty: { label: "Loyalty", to: "/loyalty" },
  domain: { label: "Domain", to: "/settings" },
};

function CheckIcon({ complete }: { complete: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        complete ? "bg-success/15 text-success" : "border border-border text-muted"
      }`}
      aria-hidden
    >
      {complete ? "✓" : ""}
    </span>
  );
}

const EXTENDED_STATUS_BADGE: Record<SetupChecklistItem["status"], { tone: "success" | "neutral" | "warning"; label: string }> = {
  complete: { tone: "success", label: "Complete" },
  in_progress: { tone: "warning", label: "In progress" },
  not_started: { tone: "neutral", label: "Not started" },
  optional: { tone: "neutral", label: "Optional" },
};

/**
 * Owner-facing "what's left before I can go live" experience (Phase 14) — the practical answer to
 * that question, not a website builder. Readiness is always computed server-side (see
 * restaurantReadiness.service.ts) and re-checked again by the publish endpoint itself; this page
 * only reflects that, it never decides readiness on its own.
 */
export function SetupPage() {
  const restaurantId = useActiveLocationId();
  const navigate = useNavigate();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [readiness, setReadiness] = useState<RestaurantReadiness | null>(null);
  const [extended, setExtended] = useState<SetupChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  function reload() {
    return Promise.all([
      apiClient.request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}`),
      apiClient.request<RestaurantReadiness>(`/restaurants/${restaurantId}/readiness`),
      apiClient.request<{ items: SetupChecklistItem[] }>(`/restaurants/${restaurantId}/setup-checklist`),
    ]).then(([restaurantData, readinessData, checklistData]) => {
      setRestaurant(restaurantData.restaurant);
      setReadiness(readinessData);
      setExtended(checklistData.items);
    });
  }

  useEffect(() => {
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePublish() {
    setError(null);
    setPublishing(true);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/publish`, { method: "PATCH" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  async function handleUnpublish() {
    if (!window.confirm("Unpublish this restaurant? It will stop being visible to customers immediately.")) return;
    setError(null);
    setPublishing(true);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/unpublish`, { method: "PATCH" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  if (loading) return <p className="text-muted">Loading setup...</p>;
  if (!restaurant || !readiness)
    return (
      <Alert tone="danger" role="alert">
        {error}
      </Alert>
    );

  const isLive = restaurant.status === "active";
  const isSuspended = restaurant.status === "suspended";

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Setup</h1>
        <p className="text-sm text-muted">
          {isSuspended
            ? "Your restaurant has been suspended and is not visible to customers."
            : isLive
              ? "Your restaurant is live and visible to customers."
              : "Finish these before your restaurant can go live."}
        </p>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {isSuspended ? (
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Badge tone="danger">Suspended</Badge>
            <span className="text-sm text-foreground">This account has been suspended by the platform.</span>
          </div>
          <p className="text-sm text-muted">
            Your storefront is hidden from customers and cannot accept new orders while suspended. Setup and
            publishing are unavailable until this is resolved.
          </p>
          <Link to="/support" className="text-sm font-medium text-primary hover:underline">
            Contact platform support →
          </Link>
        </Card>
      ) : (
        <>
          {isLive ? (
            // Phase 28 — a compact status line, not a full-page replacement: the checklist below
            // stays visible after publishing, so there's still somewhere to go for the rest of
            // setup instead of the page just ending here.
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge tone="success">Published</Badge>
                <span className="text-sm text-foreground">Customers can find and order from your storefront.</span>
              </div>
              <div className="flex flex-wrap gap-3">
                <a
                  href={storefrontUrl(restaurant.slug)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  View live storefront ↗
                </a>
                <button
                  type="button"
                  onClick={handleUnpublish}
                  disabled={publishing}
                  className="text-sm font-medium text-danger hover:underline disabled:opacity-50"
                >
                  {publishing ? "Working..." : "Unpublish"}
                </button>
              </div>
            </Card>
          ) : (
            <>
              <Card className="flex flex-col gap-1">
                <Badge tone="neutral" className="self-start">
                  Not published yet
                </Badge>
                <ul className="mt-2 flex flex-col divide-y divide-border">
                  {readiness.checks.map((check) => {
                    const link = CHECK_LINKS[check.key];
                    return (
                      <li key={check.key} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <CheckIcon complete={check.complete} />
                          <span className={`text-sm ${check.complete ? "text-foreground" : "text-foreground/80"}`}>
                            {check.label}
                          </span>
                        </div>
                        {!check.complete && link && (
                          <Link to={link.to} className="text-sm font-medium text-primary hover:underline">
                            {link.label} →
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>

              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={previewUrl(restaurant.slug)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Preview storefront ↗
                </a>
                <Button onClick={handlePublish} disabled={!readiness.ready || publishing}>
                  {publishing ? "Publishing..." : "Publish restaurant"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
                  Skip for now
                </Button>
              </div>
              {!readiness.ready && <p className="text-xs text-muted">Finish the items above to enable publishing.</p>}
            </>
          )}

          <Card className="flex flex-col gap-1">
            <p className="mb-1 text-sm font-medium text-foreground">More setup</p>
            <p className="mb-2 text-xs text-muted">
              Optional — none of this blocks publishing, but it rounds out your restaurant's setup.
            </p>
            <ul className="flex flex-col divide-y divide-border">
              {extended.map((item) => {
                const link = EXTENDED_LINKS[item.key];
                const badge = EXTENDED_STATUS_BADGE[item.status];
                return (
                  <li key={item.key} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      <span className="text-sm text-foreground/80">{item.label}</span>
                    </div>
                    {item.status !== "complete" && item.status !== "optional" && link && (
                      <Link to={link.to} className="text-sm font-medium text-primary hover:underline">
                        {link.label} →
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
