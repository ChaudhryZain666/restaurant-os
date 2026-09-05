import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Restaurant } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";
import { MapPreview } from "../components/MapPreview";
import { DeliveryProviderAccountSettingsPanel } from "../components/DeliveryProviderAccountSettingsPanel";

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
              deliveryFeeTiers: restaurant.settings.deliveryFeeTiers,
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
        {restaurant.latitude != null && restaurant.longitude != null && (
          <MapPreview
            latitude={restaurant.latitude}
            longitude={restaurant.longitude}
            radiusKm={restaurant.settings.deliveryRadiusKm}
            className="h-64 w-full rounded-lg"
          />
        )}
        <Button onClick={save} disabled={saving} className="self-start">
          {saving ? "Saving..." : "Save delivery settings"}
        </Button>
      </Card>

      {restaurant.settings.deliveryEnabled && (
        <DeliveryProviderAccountSettingsPanel restaurant={restaurant} onRestaurantChange={setRestaurant} />
      )}

      {restaurant.settings.deliveryEnabled && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-heading font-medium text-foreground">Distance-based pricing</h2>
          <p className="text-sm text-muted">
            Optional: charge a different fee depending on how far the delivery is, instead of one flat rate for the
            whole radius. The tightest-fitting bracket applies — e.g. a 3km order matches the first tier that covers
            it. Leave empty to keep the flat fee above for every distance.
          </p>
          <div className="flex flex-col gap-2">
            {(restaurant.settings.deliveryFeeTiers ?? []).map((tier, i) => (
              <div key={i} className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-sm text-muted">
                  Up to
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={tier.maxDistanceKm}
                    onChange={(e) => {
                      const tiers = [...(restaurant.settings.deliveryFeeTiers ?? [])];
                      tiers[i] = { ...tiers[i], maxDistanceKm: Number(e.target.value) };
                      setRestaurant({ ...restaurant, settings: { ...restaurant.settings, deliveryFeeTiers: tiers } });
                    }}
                    className={`w-20 ${inputClass}`}
                  />
                  km
                </label>
                <label className="flex items-center gap-1.5 text-sm text-muted">
                  Fee
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={tier.fee}
                    onChange={(e) => {
                      const tiers = [...(restaurant.settings.deliveryFeeTiers ?? [])];
                      tiers[i] = { ...tiers[i], fee: Number(e.target.value) };
                      setRestaurant({ ...restaurant, settings: { ...restaurant.settings, deliveryFeeTiers: tiers } });
                    }}
                    className={`w-24 ${inputClass}`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const tiers = (restaurant.settings.deliveryFeeTiers ?? []).filter((_, idx) => idx !== i);
                    setRestaurant({ ...restaurant, settings: { ...restaurant.settings, deliveryFeeTiers: tiers } });
                  }}
                  className="text-sm font-medium text-danger hover:underline"
                >
                  Remove
                </button>
              </div>
            ))}
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              onClick={() => {
                const tiers = [...(restaurant.settings.deliveryFeeTiers ?? []), { maxDistanceKm: 1, fee: 0 }];
                setRestaurant({ ...restaurant, settings: { ...restaurant.settings, deliveryFeeTiers: tiers } });
              }}
            >
              Add tier
            </Button>
          </div>
          <Button onClick={save} disabled={saving} className="self-start">
            {saving ? "Saving..." : "Save delivery settings"}
          </Button>
        </Card>
      )}

      <Card className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-heading font-medium text-foreground">Live ETA</h2>
          <Badge tone="neutral">Coming soon</Badge>
        </div>
        <p className="text-sm text-muted">
          A real estimated delivery time needs a routing/traffic provider — straight-line distance (what eligibility
          and pricing above use) is a reasonable approximation for "can we deliver here," but not for "how long will
          it take." Not built yet.
        </p>
      </Card>
    </div>
  );
}
