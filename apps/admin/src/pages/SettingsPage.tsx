import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { BusinessHoursDay, GeocodeResult, Restaurant, Weekday } from "@restaurant/types";
import { WEEKDAYS } from "@restaurant/types";
import { Alert, Badge, Button } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";
import { AddressAutocomplete } from "../components/AddressAutocomplete";
import { DomainSettingsPanel } from "../components/DomainSettingsPanel";
import { PaymentAccountSettingsPanel } from "../components/PaymentAccountSettingsPanel";
import { MapPreview } from "../components/MapPreview";
import { useRestaurantSettings } from "../context/RestaurantSettingsContext";
import { uploadRestaurantImage } from "../lib/uploads";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

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

const TABS = ["General", "Location", "Ordering", "Payment", "Business Hours", "Storefront", "Domain"] as const;
type Tab = (typeof TABS)[number];

/** Intl.supportedValuesOf is available in every browser this admin app already targets (Chrome
 *  99+/Firefox 102+/Safari 15.4+) — no timezone-data package needed for a plain select list. */
function timezoneOptions(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(key: "timeZone"): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

function ComingSoon({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-background p-3 text-xs text-muted">
      <Badge tone="neutral" className="shrink-0">
        Coming soon
      </Badge>
      <span>{children}</span>
    </div>
  );
}

export function SettingsPage() {
  const restaurantId = useActiveLocationId();
  const { refetch: refetchNavSettings } = useRestaurantSettings();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<Tab>("General");
  const [manualCoords, setManualCoords] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "coverImage" | null>(null);

  async function handleImageUpload(field: "logo" | "coverImage", file: File | undefined) {
    if (!file || !restaurant) return;
    setUploading(field);
    setError(null);
    try {
      const url = await uploadRestaurantImage(restaurantId, field, file);
      setRestaurant({ ...restaurant, [field]: url });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(null);
    }
  }

  useEffect(() => {
    apiClient
      .request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}`)
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
            description: restaurant.description,
            logo: restaurant.logo || undefined,
            coverImage: restaurant.coverImage || undefined,
            phone: restaurant.phone,
            email: restaurant.email,
            address: restaurant.address,
            city: restaurant.city,
            state: restaurant.state,
            country: restaurant.country,
            postalCode: restaurant.postalCode,
            latitude: restaurant.latitude ?? null,
            longitude: restaurant.longitude ?? null,
            settings: {
              pickupEnabled: restaurant.settings.pickupEnabled,
              deliveryEnabled: restaurant.settings.deliveryEnabled,
              dineInEnabled: restaurant.settings.dineInEnabled,
              orderingEnabled: restaurant.settings.orderingEnabled,
              cashEnabled: restaurant.settings.cashEnabled,
              onlinePaymentEnabled: restaurant.settings.onlinePaymentEnabled,
              currency: restaurant.settings.currency,
              timezone: restaurant.settings.timezone,
              minOrderAmount: restaurant.settings.minOrderAmount,
              taxRate: restaurant.settings.taxRate,
              deliveryFee: restaurant.settings.deliveryFee,
              temporarilyPaused: restaurant.settings.temporarilyPaused,
              pausedReason: restaurant.settings.pausedReason,
              brandColor: restaurant.settings.brandColor || undefined,
              kitchenEnabled: restaurant.settings.kitchenEnabled,
              staffEnabled: restaurant.settings.staffEnabled,
              posEnabled: restaurant.settings.posEnabled,
              businessHours:
                restaurant.settings.businessHours.length > 0 ? restaurant.settings.businessHours : defaultHours(),
            },
          },
        }
      );
      setRestaurant(updated);
      setSaved(true);
      // Phase 28 — so a kitchenEnabled/staffEnabled change takes effect in the nav (and on the
      // Kitchen/Staff pages themselves) immediately, without a full page reload.
      await refetchNavSettings();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** Only ever called with a server-resolved geocoding result (see AddressAutocomplete) — never
   *  invents coordinates from whatever text was typed into the fields below. */
  function applyGeocodeResult(result: GeocodeResult) {
    if (!restaurant) return;
    setRestaurant({
      ...restaurant,
      address: result.components?.line1 || restaurant.address,
      city: result.components?.city || restaurant.city,
      state: result.components?.state ?? restaurant.state,
      postalCode: result.components?.postalCode ?? restaurant.postalCode,
      country: result.components?.country ?? restaurant.country,
      latitude: result.latitude,
      longitude: result.longitude,
    });
    setManualCoords(false);
  }

  if (loading) return <p className="text-muted">Loading settings...</p>;
  if (!restaurant)
    return (
      <Alert tone="danger" role="alert">
        {error}
      </Alert>
    );

  return (
    <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted">Ongoing configuration for a restaurant that's already up and running.</p>
      </div>
      {restaurant.status !== "active" && (
        <Alert tone="warning">
          New here?{" "}
          <Link to="/setup" className="font-medium underline">
            Visit Setup
          </Link>{" "}
          for a guided checklist to get your restaurant ready to accept orders — Settings is for ongoing changes
          after that.
        </Alert>
      )}
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {saved && <Alert tone="success">Saved.</Alert>}

      <nav className="flex flex-wrap gap-1 border-b border-border pb-2" aria-label="Settings sections">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-pill px-3.5 py-1.5 text-sm font-medium transition-colors duration-fast ${
              tab === t ? "bg-primary/10 text-primary" : "text-foreground/70 hover:bg-black/[0.04]"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "General" && (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Restaurant name
            <input
              value={restaurant.name}
              onChange={(e) => setRestaurant({ ...restaurant, name: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Description
            <textarea
              value={restaurant.description ?? ""}
              onChange={(e) => setRestaurant({ ...restaurant, description: e.target.value })}
              rows={2}
              className={inputClass}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Phone
              <input
                value={restaurant.phone ?? ""}
                onChange={(e) => setRestaurant({ ...restaurant, phone: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Contact email
              <input
                type="email"
                value={restaurant.email ?? ""}
                onChange={(e) => setRestaurant({ ...restaurant, email: e.target.value })}
                className={inputClass}
              />
            </label>
          </div>
        </div>
      )}

      {tab === "Location" && (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Search for your restaurant's address
            <AddressAutocomplete placeholder="Start typing a street, city, or postal code…" onSelect={applyGeocodeResult} />
          </label>

          <div className="flex flex-col gap-2">
            <input
              value={restaurant.address ?? ""}
              onChange={(e) => setRestaurant({ ...restaurant, address: e.target.value })}
              placeholder="Street address"
              className={inputClass}
            />
            <div className="flex gap-2">
              <input
                value={restaurant.city ?? ""}
                onChange={(e) => setRestaurant({ ...restaurant, city: e.target.value })}
                placeholder="City"
                className={`w-full ${inputClass}`}
              />
              <input
                value={restaurant.state ?? ""}
                onChange={(e) => setRestaurant({ ...restaurant, state: e.target.value })}
                placeholder="State"
                className={`w-full ${inputClass}`}
              />
            </div>
            <div className="flex gap-2">
              <input
                value={restaurant.postalCode ?? ""}
                onChange={(e) => setRestaurant({ ...restaurant, postalCode: e.target.value })}
                placeholder="Postal code"
                className={`w-full ${inputClass}`}
              />
              <input
                value={restaurant.country ?? ""}
                onChange={(e) => setRestaurant({ ...restaurant, country: e.target.value })}
                placeholder="Country"
                className={`w-full ${inputClass}`}
              />
            </div>
          </div>

          <fieldset className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
            <legend className="px-1 text-sm font-medium">Location</legend>
            {restaurant.latitude != null && restaurant.longitude != null ? (
              <p className="text-sm text-success">
                Location set — {restaurant.latitude.toFixed(4)}, {restaurant.longitude.toFixed(4)}
              </p>
            ) : (
              <p className="text-xs text-muted">
                Search above to set your restaurant's location — this is the point delivery-radius eligibility is
                measured from (see the Delivery page).
              </p>
            )}
            {restaurant.latitude != null && restaurant.longitude != null && (
              <MapPreview latitude={restaurant.latitude} longitude={restaurant.longitude} className="h-56 w-full rounded-lg" />
            )}
            <button
              type="button"
              onClick={() => setManualCoords((v) => !v)}
              className="self-start text-xs font-medium text-primary hover:underline"
            >
              {manualCoords ? "Hide manual coordinates" : "Enter coordinates manually instead"}
            </button>
            {manualCoords && (
              <div className="flex gap-2 pt-1">
                <label className="flex w-full flex-col gap-1 text-xs text-muted">
                  Latitude
                  <input
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    value={restaurant.latitude ?? ""}
                    onChange={(e) =>
                      setRestaurant({ ...restaurant, latitude: e.target.value === "" ? undefined : Number(e.target.value) })
                    }
                    placeholder="e.g. 42.1015"
                    className={inputClass}
                  />
                </label>
                <label className="flex w-full flex-col gap-1 text-xs text-muted">
                  Longitude
                  <input
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    value={restaurant.longitude ?? ""}
                    onChange={(e) =>
                      setRestaurant({ ...restaurant, longitude: e.target.value === "" ? undefined : Number(e.target.value) })
                    }
                    placeholder="e.g. -76.5462"
                    className={inputClass}
                  />
                </label>
              </div>
            )}
          </fieldset>

        </div>
      )}

      {tab === "Ordering" && (
        <div className="flex flex-col gap-4">
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

          <fieldset className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
            <legend className="px-1 text-sm font-medium">Temporary pause</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={restaurant.settings.temporarilyPaused}
                onChange={(e) =>
                  setRestaurant({ ...restaurant, settings: { ...restaurant.settings, temporarilyPaused: e.target.checked } })
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
                className={inputClass}
              />
            )}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Minimum order amount
              <input
                type="number"
                min="0"
                step="0.01"
                value={restaurant.settings.minOrderAmount}
                onChange={(e) =>
                  setRestaurant({ ...restaurant, settings: { ...restaurant.settings, minOrderAmount: Number(e.target.value) } })
                }
                className={inputClass}
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
                onChange={(e) => setRestaurant({ ...restaurant, settings: { ...restaurant.settings, taxRate: Number(e.target.value) } })}
                className={inputClass}
              />
            </label>
          </div>

          <fieldset className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
            <legend className="px-1 text-sm font-medium">Dine-in (QR ordering)</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={restaurant.settings.dineInEnabled}
                onChange={(e) =>
                  setRestaurant({ ...restaurant, settings: { ...restaurant.settings, dineInEnabled: e.target.checked } })
                }
              />
              Accept orders from table QR codes
            </label>
            <p className="text-xs text-muted">
              Off by default. Manage your tables and print their QR codes on the{" "}
              <Link to="/tables" className="text-primary hover:underline">
                Tables page
              </Link>
              .
            </p>
          </fieldset>

          <fieldset className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
            <legend className="px-1 text-sm font-medium">Point of sale</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={restaurant.settings.posEnabled ?? false}
                onChange={(e) =>
                  setRestaurant({ ...restaurant, settings: { ...restaurant.settings, posEnabled: e.target.checked } })
                }
              />
              Enable the staff POS terminal
            </label>
            <p className="text-xs text-muted">
              Off by default. Once on, owners/managers/staff can ring up walk-in orders on the{" "}
              <Link to="/pos" className="text-primary hover:underline">
                POS page
              </Link>
              .
            </p>
          </fieldset>

          <fieldset className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
            <legend className="px-1 text-sm font-medium">Feature toggles</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={restaurant.settings.kitchenEnabled ?? true}
                onChange={(e) =>
                  setRestaurant({ ...restaurant, settings: { ...restaurant.settings, kitchenEnabled: e.target.checked } })
                }
              />
              Kitchen operations (KDS, kitchen staff, kitchen workflow)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={restaurant.settings.staffEnabled ?? true}
                onChange={(e) =>
                  setRestaurant({ ...restaurant, settings: { ...restaurant.settings, staffEnabled: e.target.checked } })
                }
              />
              Staff management (manager/staff accounts)
            </label>
            <p className="text-xs text-muted">
              Turning either off hides the corresponding section from navigation — nothing is deleted, and turning it
              back on restores it immediately. Regular ordering keeps working either way.
            </p>
          </fieldset>

          <p className="text-sm text-muted">
            Pickup, delivery, and delivery fee settings have moved to the{" "}
            <Link to="/delivery" className="text-primary hover:underline">
              Delivery page
            </Link>
            .
          </p>
        </div>
      )}

      {tab === "Payment" && (
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
            <legend className="px-1 text-sm font-medium">Payment methods</legend>
            <p className="text-xs text-muted">
              Customers will only ever see the methods enabled here — at least one must stay on.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={restaurant.settings.cashEnabled}
                onChange={(e) =>
                  setRestaurant({ ...restaurant, settings: { ...restaurant.settings, cashEnabled: e.target.checked } })
                }
              />
              Cash / pay in person
            </label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={restaurant.settings.onlinePaymentEnabled}
                  onChange={(e) =>
                    setRestaurant({
                      ...restaurant,
                      settings: { ...restaurant.settings, onlinePaymentEnabled: e.target.checked },
                    })
                  }
                />
                Online payment
              </label>
              <Badge tone={restaurant.settings.onlinePaymentEnabled ? "success" : "neutral"}>
                {restaurant.settings.onlinePaymentEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <p className="text-xs text-muted">
              Online payments run through this platform's shared payment provider by default — connect your own
              account below if you'd rather orders settle directly into it. Card/wallet details never touch this
              platform's servers either way.
            </p>
          </fieldset>

          <PaymentAccountSettingsPanel />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Currency (3-letter code)
              <input
                value={restaurant.settings.currency}
                onChange={(e) =>
                  setRestaurant({
                    ...restaurant,
                    settings: { ...restaurant.settings, currency: e.target.value.toUpperCase().slice(0, 3) },
                  })
                }
                placeholder="USD"
                maxLength={3}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Timezone
              <select
                value={restaurant.settings.timezone}
                onChange={(e) => setRestaurant({ ...restaurant, settings: { ...restaurant.settings, timezone: e.target.value } })}
                className={inputClass}
              >
                {!timezoneOptions().includes(restaurant.settings.timezone) && (
                  <option value={restaurant.settings.timezone}>{restaurant.settings.timezone}</option>
                )}
                {timezoneOptions().map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ComingSoon>
            Order times and reports already use this timezone. What's still missing: the Business Hours tab is
            informational only — orders aren't automatically closed outside them, and "closes in 5 minutes"-style
            scheduling isn't built yet. Use the Ordering tab's manual open/pause toggle until then.
          </ComingSoon>
        </div>
      )}

      {tab === "Business Hours" && (
        <fieldset className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
          <legend className="px-1 text-sm font-medium">Weekly hours</legend>
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
                      className={inputClass}
                    />
                    <span>to</span>
                    <input
                      type="time"
                      value={hours.close ?? "21:00"}
                      onChange={(e) => setRestaurant(withUpdatedHours(restaurant, day, { close: e.target.value }))}
                      className={inputClass}
                    />
                  </>
                )}
              </div>
            );
          })}
          <ComingSoon>
            Multiple periods per day (e.g. separate lunch/dinner hours) and holiday exceptions aren't supported yet.
          </ComingSoon>
        </fieldset>
      )}

      {tab === "Storefront" && (
        <div className="flex flex-col gap-4">
          <Alert tone="info">
            Looking for full theme customization — layout, typography, page sections? Visit{" "}
            <Link to="/theme-studio" className="font-medium underline">
              Theme Studio
            </Link>
            . The brand color below is a simpler, quick override that applies regardless of theme.
          </Alert>
          <fieldset className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
            <legend className="px-1 text-sm font-medium">Brand color</legend>
            <p className="text-xs text-muted">
              Overrides your storefront's primary accent color (buttons, links, highlights). Leave unset to use the
              platform default.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={restaurant.settings.brandColor ?? "#c2410c"}
                onChange={(e) => setRestaurant({ ...restaurant, settings: { ...restaurant.settings, brandColor: e.target.value } })}
                className="h-9 w-14 cursor-pointer rounded-lg border border-border"
                aria-label="Storefront brand color"
              />
              <span className="text-sm text-muted">{restaurant.settings.brandColor ?? "Using platform default"}</span>
              {restaurant.settings.brandColor && (
                <button
                  type="button"
                  onClick={() => setRestaurant({ ...restaurant, settings: { ...restaurant.settings, brandColor: undefined } })}
                  className="text-sm text-muted underline"
                >
                  Use default
                </button>
              )}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <legend className="px-1 text-sm font-medium">Logo & cover image</legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                Logo
                <div className="flex items-center gap-2">
                  {restaurant.logo && (
                    <img src={restaurant.logo} alt="" className="h-9 w-9 shrink-0 rounded-full border border-border object-cover" />
                  )}
                  <input
                    value={restaurant.logo ?? ""}
                    onChange={(e) => setRestaurant({ ...restaurant, logo: e.target.value })}
                    placeholder="https://… or upload a file"
                    className={`flex-1 ${inputClass}`}
                  />
                </div>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  disabled={uploading === "logo"}
                  onChange={(e) => handleImageUpload("logo", e.target.files?.[0])}
                  className="text-xs text-muted"
                />
                {uploading === "logo" && <span className="text-xs text-muted">Uploading…</span>}
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                Cover image
                <input
                  value={restaurant.coverImage ?? ""}
                  onChange={(e) => setRestaurant({ ...restaurant, coverImage: e.target.value })}
                  placeholder="https://… or upload a file"
                  className={inputClass}
                />
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  disabled={uploading === "coverImage"}
                  onChange={(e) => handleImageUpload("coverImage", e.target.files?.[0])}
                  className="text-xs text-muted"
                />
                {uploading === "coverImage" && <span className="text-xs text-muted">Uploading…</span>}
              </label>
            </div>
            {restaurant.coverImage && (
              <img src={restaurant.coverImage} alt="" className="h-24 w-full rounded-lg border border-border object-cover" />
            )}
          </fieldset>

          <ComingSoon>
            Secondary/accent color, typography, a dedicated hero editor, and storefront sections (featured items,
            gallery, about) aren't available yet — this stays a focused branding panel, not a full website builder.
          </ComingSoon>
        </div>
      )}

      {tab === "Domain" && <DomainSettingsPanel />}

      <Button type="submit" disabled={saving} className="self-start">
        {saving ? "Saving..." : "Save settings"}
      </Button>
    </form>
  );
}
