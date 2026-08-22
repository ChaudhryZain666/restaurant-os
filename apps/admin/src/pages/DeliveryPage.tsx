import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Restaurant } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

export function DeliveryPage() {
  const restaurantId = useActiveLocationId();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiClient
      .request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}`)
      .then((data) => setRestaurant(data.restaurant))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (!restaurant) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const { restaurant: updated } = await apiClient.request<{ restaurant: Restaurant }>(
        `/restaurants/${restaurantId}`,
        {
          method: "PATCH",
          body: {
            settings: {
              pickupEnabled: restaurant.settings.pickupEnabled,
              deliveryEnabled: restaurant.settings.deliveryEnabled,
              deliveryFee: restaurant.settings.deliveryFee,
              deliveryRadiusKm: restaurant.settings.deliveryRadiusKm,
            },
          },
        }
      );
      setRestaurant(updated);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-muted">Loading delivery settings...</p>;
  if (!restaurant)
    return (
      <Alert tone="danger" role="alert">
        {error}
      </Alert>
    );

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Delivery</h1>
        <p className="text-sm text-muted">Control how customers can receive their order.</p>
      </div>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {saved && <Alert tone="success">Saved.</Alert>}

      <Card className="flex flex-col gap-4">
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="flex flex-col">
            <span className="font-medium text-foreground">Pickup</span>
            <span className="text-xs text-muted">Customers can collect their order in person.</span>
          </span>
          <input
            type="checkbox"
            checked={restaurant.settings.pickupEnabled}
            onChange={(e) => setRestaurant({ ...restaurant, settings: { ...restaurant.settings, pickupEnabled: e.target.checked } })}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="flex flex-col">
            <span className="font-medium text-foreground">Delivery</span>
            <span className="text-xs text-muted">Customers can have their order brought to them.</span>
          </span>
          <input
            type="checkbox"
            checked={restaurant.settings.deliveryEnabled}
            onChange={(e) => setRestaurant({ ...restaurant, settings: { ...restaurant.settings, deliveryEnabled: e.target.checked } })}
          />
        </label>
        {restaurant.settings.deliveryEnabled && (
          <label className="flex flex-col gap-1 text-sm">
            Delivery fee
            <input
              type="number"
              min="0"
              step="0.01"
              value={restaurant.settings.deliveryFee}
              onChange={(e) => setRestaurant({ ...restaurant, settings: { ...restaurant.settings, deliveryFee: Number(e.target.value) } })}
              className={`max-w-[10rem] ${inputClass}`}
            />
          </label>
        )}
        <Button onClick={save} disabled={saving} className="self-start">
          {saving ? "Saving..." : "Save delivery settings"}
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-heading font-medium text-foreground">Delivery area</h2>
        {restaurant.latitude == null || restaurant.longitude == null ? (
          <Alert tone="warning" role="status">
            Set your restaurant's coordinates on the{" "}
            <Link to="/settings" className="font-medium underline">
              Settings → Location
            </Link>{" "}
            tab first — delivery eligibility is calculated from that point, so orders can't be validated against a
            radius until it's set.
          </Alert>
        ) : (
          <p className="text-sm text-muted">
            Customers within this straight-line distance of your restaurant's location can place a delivery order;
            anyone farther away sees "outside delivery area" at checkout, before they can submit an order.
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Delivery radius (km)
          <input
            type="number"
            min="0.1"
            max="100"
            step="0.1"
            value={restaurant.settings.deliveryRadiusKm ?? ""}
            onChange={(e) =>
              setRestaurant({
                ...restaurant,
                settings: {
                  ...restaurant.settings,
                  deliveryRadiusKm: e.target.value === "" ? undefined : Number(e.target.value),
                },
              })
            }
            placeholder="e.g. 8"
            disabled={restaurant.latitude == null || restaurant.longitude == null}
            className={`max-w-[10rem] ${inputClass}`}
          />
        </label>
        <Button onClick={save} disabled={saving} className="self-start">
          {saving ? "Saving..." : "Save delivery settings"}
        </Button>
      </Card>

      <Card className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-heading font-medium text-foreground">Distance-based pricing & live ETA</h2>
          <Badge tone="neutral">Coming soon</Badge>
        </div>
        <p className="text-sm text-muted">
          Delivery fee is currently a single flat rate applied to every eligible delivery order, regardless of exact
          distance within the radius — tiered/distance-based pricing and a real estimated delivery time (which would
          need a routing/traffic provider, not just straight-line distance) aren't built yet.
        </p>
      </Card>
    </div>
  );
}
