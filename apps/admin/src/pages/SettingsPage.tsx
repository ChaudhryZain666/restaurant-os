import { useEffect, useState, type FormEvent } from "react";
import type { BusinessHoursDay, Restaurant, Weekday } from "@restaurant/types";
import { WEEKDAYS } from "@restaurant/types";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";

function defaultHours(): BusinessHoursDay[] {
  return WEEKDAYS.map((day) => ({ day, isClosed: false, open: "09:00", close: "21:00" }));
}

function hoursFor(restaurant: Restaurant, day: Weekday): BusinessHoursDay {
  return (
    restaurant.settings.businessHours.find((h) => h.day === day) ?? { day, isClosed: false, open: "09:00", close: "21:00" }
  );
}

function withUpdatedHours(restaurant: Restaurant, day: Weekday, patch: Partial<BusinessHoursDay>): Restaurant {
  const existing = restaurant.settings.businessHours.length > 0 ? restaurant.settings.businessHours : defaultHours();
  const businessHours = existing.map((h) => (h.day === day ? { ...h, ...patch } : h));
  return { ...restaurant, settings: { ...restaurant.settings, businessHours } };
}

export function SettingsPage() {
  const { user } = useAuth();
  const restaurantId = user!.restaurantId!;
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiClient
      .request<{ restaurant: Restaurant }>("/restaurants/me")
      .then((data) => setRestaurant(data.restaurant))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
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
            name: restaurant.name,
            phone: restaurant.phone,
            email: restaurant.email,
            address: restaurant.address,
            city: restaurant.city,
            state: restaurant.state,
            country: restaurant.country,
            postalCode: restaurant.postalCode,
            settings: {
              pickupEnabled: restaurant.settings.pickupEnabled,
              deliveryEnabled: restaurant.settings.deliveryEnabled,
              orderingEnabled: restaurant.settings.orderingEnabled,
              minOrderAmount: restaurant.settings.minOrderAmount,
              taxRate: restaurant.settings.taxRate,
              deliveryFee: restaurant.settings.deliveryFee,
              temporarilyPaused: restaurant.settings.temporarilyPaused,
              pausedReason: restaurant.settings.pausedReason,
              businessHours:
                restaurant.settings.businessHours.length > 0 ? restaurant.settings.businessHours : defaultHours(),
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

  if (loading) return <p>Loading settings...</p>;
  if (!restaurant) return <p role="alert">{error}</p>;

  return (
    <form onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {saved && <p className="text-green-700">Saved.</p>}

      <label className="flex flex-col gap-1 text-sm">
        Restaurant name
        <input
          value={restaurant.name}
          onChange={(e) => setRestaurant({ ...restaurant, name: e.target.value })}
          className="rounded border px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Phone
        <input
          value={restaurant.phone ?? ""}
          onChange={(e) => setRestaurant({ ...restaurant, phone: e.target.value })}
          className="rounded border px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Contact email
        <input
          type="email"
          value={restaurant.email ?? ""}
          onChange={(e) => setRestaurant({ ...restaurant, email: e.target.value })}
          className="rounded border px-2 py-1"
        />
      </label>

      <fieldset className="flex flex-col gap-2 rounded border p-3">
        <legend className="px-1 text-sm font-medium">Address</legend>
        <input
          value={restaurant.address ?? ""}
          onChange={(e) => setRestaurant({ ...restaurant, address: e.target.value })}
          placeholder="Street address"
          className="rounded border px-2 py-1"
        />
        <div className="flex gap-2">
          <input
            value={restaurant.city ?? ""}
            onChange={(e) => setRestaurant({ ...restaurant, city: e.target.value })}
            placeholder="City"
            className="w-full rounded border px-2 py-1"
          />
          <input
            value={restaurant.state ?? ""}
            onChange={(e) => setRestaurant({ ...restaurant, state: e.target.value })}
            placeholder="State"
            className="w-full rounded border px-2 py-1"
          />
        </div>
        <div className="flex gap-2">
          <input
            value={restaurant.postalCode ?? ""}
            onChange={(e) => setRestaurant({ ...restaurant, postalCode: e.target.value })}
            placeholder="Postal code"
            className="w-full rounded border px-2 py-1"
          />
          <input
            value={restaurant.country ?? ""}
            onChange={(e) => setRestaurant({ ...restaurant, country: e.target.value })}
            placeholder="Country"
            className="w-full rounded border px-2 py-1"
          />
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={restaurant.settings.orderingEnabled}
          onChange={(e) =>
            setRestaurant({ ...restaurant, settings: { ...restaurant.settings, orderingEnabled: e.target.checked } })
          }
        />
        Accepting orders (indefinite kill switch)
      </label>

      <fieldset className="flex flex-col gap-2 rounded border p-3">
        <legend className="px-1 text-sm font-medium">Temporary pause</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={restaurant.settings.temporarilyPaused}
            onChange={(e) =>
              setRestaurant({
                ...restaurant,
                settings: { ...restaurant.settings, temporarilyPaused: e.target.checked },
              })
            }
          />
          Temporarily not accepting orders (e.g. kitchen is slammed)
        </label>
        {restaurant.settings.temporarilyPaused && (
          <input
            value={restaurant.settings.pausedReason ?? ""}
            onChange={(e) =>
              setRestaurant({ ...restaurant, settings: { ...restaurant.settings, pausedReason: e.target.value } })
            }
            placeholder="Reason shown to customers (optional)"
            className="rounded border px-2 py-1"
          />
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={restaurant.settings.pickupEnabled}
          onChange={(e) =>
            setRestaurant({ ...restaurant, settings: { ...restaurant.settings, pickupEnabled: e.target.checked } })
          }
        />
        Pickup enabled
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={restaurant.settings.deliveryEnabled}
          onChange={(e) =>
            setRestaurant({ ...restaurant, settings: { ...restaurant.settings, deliveryEnabled: e.target.checked } })
          }
        />
        Delivery enabled
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Minimum order amount
        <input
          type="number"
          min="0"
          step="0.01"
          value={restaurant.settings.minOrderAmount}
          onChange={(e) =>
            setRestaurant({
              ...restaurant,
              settings: { ...restaurant.settings, minOrderAmount: Number(e.target.value) },
            })
          }
          className="rounded border px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Tax rate (e.g. 0.08 = 8%)
        <input
          type="number"
          min="0"
          max="1"
          step="0.0001"
          value={restaurant.settings.taxRate}
          onChange={(e) =>
            setRestaurant({ ...restaurant, settings: { ...restaurant.settings, taxRate: Number(e.target.value) } })
          }
          className="rounded border px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Delivery fee
        <input
          type="number"
          min="0"
          step="0.01"
          value={restaurant.settings.deliveryFee}
          onChange={(e) =>
            setRestaurant({
              ...restaurant,
              settings: { ...restaurant.settings, deliveryFee: Number(e.target.value) },
            })
          }
          className="rounded border px-2 py-1"
        />
      </label>

      <fieldset className="flex flex-col gap-2 rounded border p-3">
        <legend className="px-1 text-sm font-medium">Business hours</legend>
        {WEEKDAYS.map((day) => {
          const hours = hoursFor(restaurant, day);
          return (
            <div key={day} className="flex items-center gap-2 text-sm">
              <span className="w-24 capitalize">{day}</span>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={hours.isClosed}
                  onChange={(e) => setRestaurant(withUpdatedHours(restaurant, day, { isClosed: e.target.checked }))}
                />
                Closed
              </label>
              {!hours.isClosed && (
                <>
                  <input
                    type="time"
                    value={hours.open ?? "09:00"}
                    onChange={(e) => setRestaurant(withUpdatedHours(restaurant, day, { open: e.target.value }))}
                    className="rounded border px-2 py-1"
                  />
                  <span>to</span>
                  <input
                    type="time"
                    value={hours.close ?? "21:00"}
                    onChange={(e) => setRestaurant(withUpdatedHours(restaurant, day, { close: e.target.value }))}
                    className="rounded border px-2 py-1"
                  />
                </>
              )}
            </div>
          );
        })}
      </fieldset>

      <button type="submit" disabled={saving} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
        {saving ? "Saving..." : "Save settings"}
      </button>
    </form>
  );
}
