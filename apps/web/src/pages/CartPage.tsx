import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type {
  Address,
  DeliveryEligibilityResult,
  GeocodeResult,
  Order,
  OrderPaymentMethod,
  OrderType,
  PromoValidationResult,
} from "@restaurant/types";
import { Alert, Button, Card, EmptyState } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { useRestaurant } from "../context/RestaurantContext";
import { useTable } from "../context/TableContext";
import { AddressAutocomplete } from "../components/AddressAutocomplete";
import { useNoIndex } from "../hooks/useNoIndex";

const ORDER_TYPE_LABELS: Record<OrderType, string> = { pickup: "Pickup", delivery: "Delivery", dine_in: "Dine-in" };

function formatAddress(a: Address): string {
  return [a.line1, a.line2, a.city, a.state, a.postalCode].filter(Boolean).join(", ");
}

const MANUAL_ADDRESS = "__manual__";

interface DeliveryDraft {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  instructions: string;
}

function emptyDeliveryDraft(): DeliveryDraft {
  return { line1: "", line2: "", city: "", state: "", postalCode: "", latitude: "", longitude: "", instructions: "" };
}

function draftFromAddress(a: Address, instructions: string): DeliveryDraft {
  return {
    line1: a.line1,
    line2: a.line2 ?? "",
    city: a.city,
    state: a.state ?? "",
    postalCode: a.postalCode ?? "",
    latitude: a.latitude != null ? String(a.latitude) : "",
    longitude: a.longitude != null ? String(a.longitude) : "",
    instructions,
  };
}

function CartGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden>
      <circle cx="9" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.5 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 8H6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CartPage() {
  useNoIndex();
  const { lines, cartRestaurantId, setQuantity, removeItem, subtotal, clear } = useCart();
  const { user } = useAuth();
  const { restaurant, availability } = useRestaurant();
  const { table, tableToken, clearTable } = useTable();
  const orderingOpen = availability?.status === "open";
  const navigate = useNavigate();
  const location = useLocation();

  // The cart is scoped to whichever restaurant its items belong to (CartContext) — this only
  // matters if the customer navigated straight to /r/:otherSlug/cart with a cart already
  // populated elsewhere (MenuPage's own add-to-cart flow already blocks this earlier). Nothing
  // gets silently mixed either way: order creation is priced against THIS restaurant's menu, so a
  // mismatched item would simply fail server-side — this banner just explains why up front.
  const restaurantMismatch = Boolean(cartRestaurantId && restaurant && cartRestaurantId !== restaurant.id);

  const dineInAvailable = Boolean(table && restaurant?.settings.dineInEnabled);
  // Only ever offer order types this restaurant has actually enabled — the server independently
  // re-validates this too (createOrder), but the UI shouldn't let a customer pick something that's
  // guaranteed to be rejected.
  const orderTypeOptions: OrderType[] = [
    ...(dineInAvailable ? (["dine_in"] as const) : []),
    ...(restaurant?.settings.pickupEnabled ? (["pickup"] as const) : []),
    ...(restaurant?.settings.deliveryEnabled ? (["delivery"] as const) : []),
  ];
  const paymentMethodOptions: Array<{ value: OrderPaymentMethod; label: string; hint: string }> = [
    ...(restaurant?.settings.cashEnabled ? [{ value: "cash" as const, label: "Cash", hint: "Pay in person" }] : []),
    ...(restaurant?.settings.onlinePaymentEnabled
      ? [{ value: "online" as const, label: "Pay online", hint: "Card, wallet, etc." }]
      : []),
  ];

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderType, setOrderType] = useState<OrderType>(dineInAvailable ? "dine_in" : "pickup");
  const [paymentMethod, setPaymentMethod] = useState<OrderPaymentMethod>("cash");
  const [loyaltyBalance, setLoyaltyBalance] = useState<number | null>(null);
  const [redeemPointsInput, setRedeemPointsInput] = useState(0);
  const [savedAddresses, setSavedAddresses] = useState<Address[]>([]);
  const [addressChoice, setAddressChoice] = useState<string>(MANUAL_ADDRESS);
  const [deliveryDraft, setDeliveryDraft] = useState<DeliveryDraft>(emptyDeliveryDraft());
  const [manualCoords, setManualCoords] = useState(false);
  const [eligibility, setEligibility] = useState<DeliveryEligibilityResult | null>(null);
  const [checkingEligibility, setCheckingEligibility] = useState(false);
  const [customerNotes, setCustomerNotes] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [checkingPromo, setCheckingPromo] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; name: string; discount: number } | null>(null);

  function updateDeliveryField(patch: Partial<DeliveryDraft>) {
    setDeliveryDraft((prev) => ({ ...prev, ...patch }));
  }

  // Customer-facing estimate only — tax is always calculated server-side in createOrder and only
  // shown once the order is placed (unchanged from before Phase 9, for every order type). The
  // delivery fee is the one figure surfaced here ahead of checkout: it's the server-computed,
  // eligibility-confirmed fee from the same "Delivery available" banner below, not a client guess.
  const subtotalAfterDiscount = Math.max(0, subtotal - (appliedPromo?.discount ?? 0));
  const deliveryFeeForDisplay = orderType === "delivery" && eligibility?.eligible ? (eligibility.deliveryFee ?? 0) : 0;
  const appliedLoyaltyDiscount = Math.min(redeemPointsInput, subtotalAfterDiscount);
  const estimatedTotal =
    Math.round((subtotalAfterDiscount - appliedLoyaltyDiscount + deliveryFeeForDisplay) * 100) / 100;

  const reorderNotice = (location.state as { reorderNotice?: string } | null)?.reorderNotice;

  // Table resolution (TableContext) finishes asynchronously, often after this page has already
  // mounted with the "pickup" default — once it lands, dine-in becomes the natural default for
  // someone who scanned a QR code, without overriding a choice they've already made themselves.
  const dineInDefaultApplied = useRef(false);
  useEffect(() => {
    if (dineInAvailable && !dineInDefaultApplied.current) {
      dineInDefaultApplied.current = true;
      setOrderType("dine_in");
    }
  }, [dineInAvailable]);

  // Once the restaurant's real settings load, fall back off any order type / payment method
  // that isn't actually enabled here (the initial state above is only ever a pre-load guess).
  useEffect(() => {
    if (orderTypeOptions.length > 0 && !orderTypeOptions.includes(orderType)) {
      setOrderType(orderTypeOptions[0]);
    }
  }, [orderTypeOptions, orderType]);
  useEffect(() => {
    if (paymentMethodOptions.length > 0 && !paymentMethodOptions.some((o) => o.value === paymentMethod)) {
      setPaymentMethod(paymentMethodOptions[0].value);
    }
  }, [paymentMethodOptions, paymentMethod]);

  useEffect(() => {
    if (!user) return;
    apiClient
      .request<{ addresses: Address[] }>("/users/me/addresses")
      .then((data) => {
        setSavedAddresses(data.addresses);
        const defaultAddress = data.addresses.find((a) => a.isDefault) ?? data.addresses[0];
        if (defaultAddress) {
          setAddressChoice(defaultAddress.id);
          setDeliveryDraft(draftFromAddress(defaultAddress, ""));
        }
      })
      .catch(() => {
        // Saved addresses are a convenience, not a requirement — checkout still works via manual entry.
      });
  }, [user]);

  useEffect(() => {
    if (!user || !restaurant) return;
    apiClient
      .request<{ account: { pointsBalance: number } }>(`/restaurants/${restaurant.id}/loyalty/me`)
      .then((data) => setLoyaltyBalance(data.account.pointsBalance))
      .catch(() => {
        // Loyalty is a convenience, not a requirement — checkout still works without it.
      });
  }, [user, restaurant]);

  // Phase 28 — a reward picked on the Loyalty page (apps/web's LoyaltyPage.tsx "Redeem" button)
  // arrives here as router state, same pattern as reorderNotice above. This is purely a UI
  // pre-fill of the EXISTING redemption control below — it still resolves to the same plain
  // redeemPoints number sent to order creation, nothing new server-side. Applied once, clamped to
  // whatever's actually affordable, so it never claims more than the reward's real cost.
  const rewardPointsRequested = (location.state as { redeemRewardPoints?: number } | null)?.redeemRewardPoints;
  const rewardPrefillApplied = useRef(false);
  useEffect(() => {
    if (!rewardPointsRequested || rewardPrefillApplied.current || loyaltyBalance === null) return;
    rewardPrefillApplied.current = true;
    setRedeemPointsInput(Math.min(rewardPointsRequested, loyaltyBalance, Math.floor(subtotalAfterDiscount)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewardPointsRequested, loyaltyBalance]);

  // Re-clamp if a promo applied afterward shrinks the subtotal below the points already selected —
  // the server would reject/re-cap this anyway, but the displayed total shouldn't drift from what
  // will actually be charged.
  useEffect(() => {
    setRedeemPointsInput((prev) => Math.min(prev, Math.floor(subtotalAfterDiscount)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotalAfterDiscount]);

  function selectAddress(value: string) {
    setAddressChoice(value);
    setManualCoords(false);
    if (value === MANUAL_ADDRESS) {
      setDeliveryDraft(emptyDeliveryDraft());
      return;
    }
    const address = savedAddresses.find((a) => a.id === value);
    if (address) setDeliveryDraft(draftFromAddress(address, deliveryDraft.instructions));
  }

  /** Only ever called with a server-resolved geocoding result (see AddressAutocomplete) — never
   *  invents coordinates from whatever the customer had typed. A fresh search always means "not
   *  one of my saved addresses" — reflected in the dropdown so the two selection paths don't
   *  silently disagree with each other. */
  function applyGeocodeResult(result: GeocodeResult) {
    setAddressChoice(MANUAL_ADDRESS);
    setManualCoords(false);
    setDeliveryDraft((prev) => ({
      ...prev,
      line1: result.components?.line1 || prev.line1,
      city: result.components?.city || prev.city,
      state: result.components?.state ?? prev.state,
      postalCode: result.components?.postalCode ?? prev.postalCode,
      latitude: String(result.latitude),
      longitude: String(result.longitude),
    }));
  }

  // Live "is this deliverable" preview — debounced so it doesn't fire on every keystroke while
  // typing coordinates, and only ever runs with server-validated restaurant/eligibility logic
  // (delivery.service.ts); the fee/distance shown here always comes back from that call, never
  // computed client-side. Only meaningful once logged in (the check endpoint is identity-scoped
  // like the promo-code check below), and only while "Delivery" is actually selected.
  useEffect(() => {
    if (orderType !== "delivery" || !user || !restaurant) {
      setEligibility(null);
      return;
    }
    const lat = Number(deliveryDraft.latitude);
    const lng = Number(deliveryDraft.longitude);
    if (!deliveryDraft.latitude || !deliveryDraft.longitude || Number.isNaN(lat) || Number.isNaN(lng)) {
      setEligibility(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setCheckingEligibility(true);
      apiClient
        .request<DeliveryEligibilityResult>(`/restaurants/${restaurant.id}/delivery/check`, {
          method: "POST",
          body: { latitude: lat, longitude: lng },
        })
        .then((result) => {
          if (!cancelled) setEligibility(result);
        })
        .catch((err) => {
          if (!cancelled) setEligibility({ eligible: false, reason: (err as Error).message });
        })
        .finally(() => {
          if (!cancelled) setCheckingEligibility(false);
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orderType, user, restaurant, deliveryDraft.latitude, deliveryDraft.longitude]);

  async function applyPromo() {
    if (!restaurant || !promoInput.trim()) return;
    setCheckingPromo(true);
    setPromoError(null);
    try {
      const result = await apiClient.request<PromoValidationResult>(`/restaurants/${restaurant.id}/promotions/check`, {
        method: "POST",
        body: { code: promoInput.trim(), subtotal },
      });
      if (result.valid && result.promotion && result.discount !== undefined) {
        setAppliedPromo({ code: result.promotion.code, name: result.promotion.name, discount: result.discount });
      } else {
        setAppliedPromo(null);
        setPromoError(result.reason ?? "Invalid promo code");
      }
    } catch (err) {
      setAppliedPromo(null);
      setPromoError((err as Error).message);
    } finally {
      setCheckingPromo(false);
    }
  }

  function removePromo() {
    setAppliedPromo(null);
    setPromoInput("");
    setPromoError(null);
  }

  async function placeOrder() {
    if (!user) return navigate("/login", { state: { from: location } });
    if (!restaurant) return;
    if (orderType === "delivery") {
      if (!deliveryDraft.line1.trim() || !deliveryDraft.city.trim()) {
        setError("Delivery address is required for delivery orders");
        return;
      }
      if (!deliveryDraft.latitude || !deliveryDraft.longitude) {
        setError("Delivery coordinates are required so we can check you're within the delivery area");
        return;
      }
      if (!eligibility?.eligible) {
        setError(eligibility?.reason ?? "This address isn't eligible for delivery");
        return;
      }
    }
    if (orderType === "dine_in" && !tableToken) {
      setError("Table context was lost — please rescan the table's QR code and try again");
      return;
    }
    setPlacing(true);
    setError(null);
    try {
      const { order } = await apiClient.request<{ order: Order }>(`/restaurants/${restaurant.id}/orders`, {
        method: "POST",
        body: {
          items: lines.map((l) => ({
            menuItemId: l.menuItem.id,
            quantity: l.quantity,
            selectedModifiers: l.selectedModifiers.map((m) => ({ groupId: m.groupId, optionId: m.optionId })),
            specialInstructions: l.specialInstructions,
          })),
          orderType,
          paymentMethod,
          deliveryAddress:
            orderType === "delivery"
              ? {
                  line1: deliveryDraft.line1,
                  line2: deliveryDraft.line2 || undefined,
                  city: deliveryDraft.city,
                  state: deliveryDraft.state || undefined,
                  postalCode: deliveryDraft.postalCode || undefined,
                  latitude: Number(deliveryDraft.latitude),
                  longitude: Number(deliveryDraft.longitude),
                  instructions: deliveryDraft.instructions || undefined,
                }
              : undefined,
          tableToken: orderType === "dine_in" ? tableToken ?? undefined : undefined,
          customerNotes: customerNotes || undefined,
          redeemPoints: appliedLoyaltyDiscount,
          promoCode: appliedPromo?.code,
        },
      });
      clear();
      navigate(`/orders/${order.id}`, { state: { justPlaced: true } });
    } catch (err) {
      setError((err as Error).message);
      setPlacing(false);
    }
  }

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState
          icon={<CartGlyph className="h-6 w-6" />}
          title="Your cart is empty"
          description="Add something tasty from the menu to get started."
          action={
            <Button onClick={() => navigate(restaurant ? `/r/${restaurant.slug}` : "/")} variant="secondary">
              Browse the menu
            </Button>
          }
        />
      </div>
    );
  }

  if (restaurantMismatch) {
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState
          icon={<CartGlyph className="h-6 w-6" />}
          title="Your cart is for a different restaurant"
          description={`Your cart has items from another restaurant, not ${restaurant?.name ?? "this one"}. Clear it to order here instead.`}
          action={
            <Button onClick={clear} variant="secondary">
              Clear cart
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold text-foreground">Cart</h1>
      {reorderNotice && (
        <Alert tone="warning" role="alert">
          {reorderNotice}
        </Alert>
      )}

      <Card className="flex flex-col gap-3">
        <ul className="flex flex-col divide-y divide-border">
          {lines.map((line) => (
            <li key={line.lineId} className="flex items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{line.menuItem.name}</p>
                {line.selectedModifiers.length > 0 && (
                  <p className="truncate text-muted">
                    {line.selectedModifiers
                      .map((m) =>
                        m.priceAdjustment > 0
                          ? `${m.optionName} (+${formatCurrency(m.priceAdjustment, restaurant?.settings.currency)})`
                          : m.optionName
                      )
                      .join(", ")}
                  </p>
                )}
                {line.specialInstructions && <p className="truncate text-xs italic text-muted">"{line.specialInstructions}"</p>}
                <p className="text-muted">
                  {formatCurrency(
                    line.menuItem.price + line.selectedModifiers.reduce((sum, m) => sum + m.priceAdjustment, 0),
                    restaurant?.settings.currency
                  )}{" "}
                  each
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <input
                  type="number"
                  min={1}
                  value={line.quantity}
                  onChange={(e) => setQuantity(line.lineId, Number(e.target.value))}
                  className="h-9 w-14 rounded-md border border-border bg-surface px-2 text-center"
                  aria-label={`Quantity for ${line.menuItem.name}`}
                />
                <button
                  onClick={() => removeItem(line.lineId)}
                  className="text-sm font-medium text-danger transition-opacity duration-fast hover:opacity-70"
                  type="button"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <div className="flex justify-between text-foreground">
            <span>Subtotal</span>
            <span>{formatCurrency(subtotal, restaurant?.settings.currency)}</span>
          </div>
          {appliedPromo && (
            <div className="flex justify-between text-success">
              <span>Promo {appliedPromo.code}</span>
              <span>-{formatCurrency(appliedPromo.discount, restaurant?.settings.currency)}</span>
            </div>
          )}
          {orderType === "delivery" && eligibility?.eligible && eligibility.deliveryFee != null && (
            <div className="flex justify-between text-foreground">
              <span>Delivery fee</span>
              <span>{formatCurrency(eligibility.deliveryFee, restaurant?.settings.currency)}</span>
            </div>
          )}
          {appliedLoyaltyDiscount > 0 && (
            <div className="flex justify-between text-success">
              <span>Loyalty points ({redeemPointsInput})</span>
              <span>-{formatCurrency(appliedLoyaltyDiscount, restaurant?.settings.currency)}</span>
            </div>
          )}
          <div className="flex justify-between font-medium text-foreground">
            <span>Estimated total</span>
            <span>{formatCurrency(estimatedTotal, restaurant?.settings.currency)}</span>
          </div>
          <p className="text-xs text-muted">Tax is calculated at checkout — the final total is confirmed on the next page.</p>
        </div>
      </Card>

      <Card className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground">Promo code</label>
        {appliedPromo ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm">
            <span className="text-foreground">
              <strong className="font-mono">{appliedPromo.code}</strong> applied — {appliedPromo.name}
            </span>
            <button onClick={removePromo} className="font-medium text-danger hover:underline" type="button">
              Remove
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
              placeholder="Enter a code"
              className="flex-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono"
            />
            <Button type="button" variant="outline" size="sm" onClick={applyPromo} disabled={checkingPromo || !promoInput.trim()}>
              {checkingPromo ? "Checking..." : "Apply"}
            </Button>
          </div>
        )}
        {promoError && <p className="text-sm text-danger">{promoError}</p>}
      </Card>

      {user && loyaltyBalance !== null && loyaltyBalance > 0 && (
        <Card className="flex flex-col gap-2">
          <label className="text-sm font-medium text-foreground">Loyalty points</label>
          <p className="text-xs text-muted">
            You have <strong>{loyaltyBalance}</strong> point{loyaltyBalance === 1 ? "" : "s"} available — 1 point ={" "}
            {formatCurrency(1, restaurant?.settings.currency)} off, up to your order subtotal.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={Math.min(loyaltyBalance, Math.floor(subtotalAfterDiscount))}
              value={redeemPointsInput}
              onChange={(e) => {
                const max = Math.min(loyaltyBalance, Math.floor(subtotalAfterDiscount));
                const next = Math.max(0, Math.min(max, Number(e.target.value) || 0));
                setRedeemPointsInput(next);
              }}
              className="w-28 rounded-md border border-border bg-surface px-2 py-1.5"
              aria-label="Points to redeem"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRedeemPointsInput(Math.min(loyaltyBalance, Math.floor(subtotalAfterDiscount)))}
            >
              Use max
            </Button>
            {redeemPointsInput > 0 && (
              <button type="button" onClick={() => setRedeemPointsInput(0)} className="text-sm font-medium text-danger hover:underline">
                Clear
              </button>
            )}
          </div>
        </Card>
      )}

      <Card className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-foreground">Order type</legend>
          <div className="flex gap-2">
            {orderTypeOptions.map((type) => (
              <label
                key={type}
                className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-center text-sm font-medium transition-colors duration-fast ${
                  orderType === type ? "border-primary bg-primary/5 text-primary" : "border-border text-foreground hover:bg-black/[0.02]"
                }`}
              >
                <input
                  type="radio"
                  name="orderType"
                  value={type}
                  checked={orderType === type}
                  onChange={() => setOrderType(type)}
                  className="sr-only"
                />
                {ORDER_TYPE_LABELS[type]}
              </label>
            ))}
          </div>
          {orderType === "dine_in" && table && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background p-3 text-sm">
              <span className="text-foreground">
                Served at <strong>{table.name}</strong>
                {table.section ? ` · ${table.section}` : ""}
              </span>
              <button
                type="button"
                onClick={() => {
                  clearTable();
                  setOrderType("pickup");
                }}
                className="font-medium text-foreground/70 hover:underline"
              >
                Not your table?
              </button>
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-foreground">Payment</legend>
          {paymentMethodOptions.length === 0 && (
            <p className="text-sm text-danger">This restaurant hasn't enabled a payment method yet.</p>
          )}
          <div className="flex gap-2">
            {paymentMethodOptions.map((option) => (
              <label
                key={option.value}
                className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-center text-sm font-medium transition-colors duration-fast ${
                  paymentMethod === option.value
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-foreground hover:bg-black/[0.02]"
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={option.value}
                  checked={paymentMethod === option.value}
                  onChange={() => setPaymentMethod(option.value)}
                  className="sr-only"
                />
                {option.label}
                <span className="block text-xs font-normal text-muted">{option.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {orderType === "delivery" && (
          <div className="flex flex-col gap-2">
            {savedAddresses.length > 0 && (
              <label className="flex flex-col gap-1 text-sm">
                Delivery address
                <select
                  value={addressChoice}
                  onChange={(e) => selectAddress(e.target.value)}
                  className="rounded-md border border-border bg-surface px-2 py-1.5"
                >
                  {savedAddresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label ? `${a.label} — ` : ""}
                      {formatAddress(a)}
                      {a.latitude == null ? " (no coordinates)" : ""}
                    </option>
                  ))}
                  <option value={MANUAL_ADDRESS}>Enter a different address</option>
                </select>
              </label>
            )}

            <div className="flex flex-col gap-2">
              <AddressAutocomplete
                placeholder="Search for your delivery address…"
                onSelect={applyGeocodeResult}
                resetKey={addressChoice}
              />

              <input
                value={deliveryDraft.line1}
                onChange={(e) => updateDeliveryField({ line1: e.target.value })}
                required
                placeholder="Street address"
                className="rounded-md border border-border bg-surface px-2 py-1.5"
              />
              <input
                value={deliveryDraft.line2}
                onChange={(e) => updateDeliveryField({ line2: e.target.value })}
                placeholder="Apt / suite (optional)"
                className="rounded-md border border-border bg-surface px-2 py-1.5"
              />
              <div className="flex gap-2">
                <input
                  value={deliveryDraft.city}
                  onChange={(e) => updateDeliveryField({ city: e.target.value })}
                  required
                  placeholder="City"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1.5"
                />
                <input
                  value={deliveryDraft.state}
                  onChange={(e) => updateDeliveryField({ state: e.target.value })}
                  placeholder="State"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1.5"
                />
                <input
                  value={deliveryDraft.postalCode}
                  onChange={(e) => updateDeliveryField({ postalCode: e.target.value })}
                  placeholder="Postal code"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1.5"
                />
              </div>

              <div className="flex flex-col gap-1 rounded-lg border border-border bg-background p-2.5">
                {deliveryDraft.latitude && deliveryDraft.longitude ? (
                  <p className="text-xs text-success">
                    Location set — {Number(deliveryDraft.latitude).toFixed(4)}, {Number(deliveryDraft.longitude).toFixed(4)}
                  </p>
                ) : (
                  <p className="text-xs text-muted">Search for your address above to set its location.</p>
                )}
                <button
                  type="button"
                  onClick={() => setManualCoords((v) => !v)}
                  className="self-start text-xs font-medium text-primary hover:underline"
                >
                  {manualCoords ? "Hide manual coordinates" : "Enter coordinates manually instead"}
                </button>
                {manualCoords && (
                  <div className="flex flex-col gap-1 pt-1">
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="any"
                        min={-90}
                        max={90}
                        value={deliveryDraft.latitude}
                        onChange={(e) => updateDeliveryField({ latitude: e.target.value })}
                        placeholder="Latitude"
                        className="w-full rounded-md border border-border bg-surface px-2 py-1.5"
                      />
                      <input
                        type="number"
                        step="any"
                        min={-180}
                        max={180}
                        value={deliveryDraft.longitude}
                        onChange={(e) => updateDeliveryField({ longitude: e.target.value })}
                        placeholder="Longitude"
                        className="w-full rounded-md border border-border bg-surface px-2 py-1.5"
                      />
                    </div>
                    <a
                      href="https://www.google.com/maps"
                      target="_blank"
                      rel="noreferrer"
                      className="self-start text-xs font-medium text-primary hover:underline"
                    >
                      Find your coordinates on Google Maps ↗
                    </a>
                  </div>
                )}
              </div>

              <input
                value={deliveryDraft.instructions}
                onChange={(e) => updateDeliveryField({ instructions: e.target.value })}
                placeholder="Delivery instructions (gate code, leave at door, etc.)"
                maxLength={300}
                className="rounded-md border border-border bg-surface px-2 py-1.5"
              />
            </div>

            {deliveryDraft.latitude && deliveryDraft.longitude && (
              <div
                className={`rounded-lg border px-3 py-2 text-sm ${
                  checkingEligibility
                    ? "border-border bg-background text-muted"
                    : eligibility?.eligible
                      ? "border-success/30 bg-success/5 text-success"
                      : "border-warning/30 bg-warning/5 text-warning"
                }`}
                role="status"
              >
                {checkingEligibility
                  ? "Checking delivery availability…"
                  : eligibility?.eligible
                    ? `Delivery available${eligibility.distanceKm != null ? ` — ${eligibility.distanceKm}km away` : ""}${
                        eligibility.deliveryFee != null
                          ? ` · ${formatCurrency(eligibility.deliveryFee, restaurant?.settings.currency)} delivery fee`
                          : ""
                      }`
                    : (eligibility?.reason ?? "Enter a valid latitude and longitude to check delivery availability")}
              </div>
            )}
          </div>
        )}

        {orderType !== "delivery" && (
          <label className="flex flex-col gap-1 text-sm">
            Notes (optional)
            <input
              value={customerNotes}
              onChange={(e) => setCustomerNotes(e.target.value)}
              placeholder="Anything the kitchen should know?"
              className="rounded-md border border-border bg-surface px-2 py-1.5"
            />
          </label>
        )}
      </Card>

      {!orderingOpen && (
        <Alert tone="warning" role="alert">
          This restaurant isn't accepting orders right now — you can review your cart but can't check out yet.
        </Alert>
      )}
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      <Button
        onClick={placeOrder}
        disabled={
          placing ||
          !orderingOpen ||
          (orderType === "dine_in" && !tableToken) ||
          (orderType === "delivery" && !eligibility?.eligible)
        }
        size="lg"
      >
        {placing
          ? "Placing order..."
          : paymentMethod === "online"
            ? `Continue to payment — ${formatCurrency(estimatedTotal, restaurant?.settings.currency)}`
            : `Place order — ${formatCurrency(estimatedTotal, restaurant?.settings.currency)}`}
      </Button>
    </div>
  );
}
