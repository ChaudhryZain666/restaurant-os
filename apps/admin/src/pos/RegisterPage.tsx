import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import type { MenuItem, ModifierGroup, Order, TableWithStatus } from "@restaurant/types";
import { EmptyState, Skeleton } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";
import { useRestaurantSettings } from "../context/RestaurantSettingsContext";
import { IconRegister } from "../components/icons";
import { MenuBrowser } from "./components/MenuBrowser";
import { ModifierSheet } from "./components/ModifierSheet";
import { OrderPanel } from "./components/OrderPanel";
import { CustomerPicker, type WalkInDraft } from "./components/CustomerPicker";
import { CompletedSale } from "./components/CompletedSale";
import type { CartLine, CustomerHit, MenuResponse, OrderTypeSel, PosPaymentMethod, SelectedModifier } from "./types";
import { lineKey, lineTotal } from "./types";

/**
 * The redesigned register — same data flow as the original PosPage.tsx (GET .../menu, GET
 * .../tables, POST .../pos/orders, unchanged), split into MenuBrowser / ModifierSheet /
 * CustomerPicker / OrderPanel / CompletedSale so each concern is testable and readable on its
 * own, with this page owning the actual sale state (cart, customer, order type, payment) the
 * same way the original single-file page did — no premature Context/reducer for state this
 * page and its direct children already share cleanly via props.
 */
export function RegisterPage() {
  const restaurantId = useActiveLocationId();
  const { restaurant } = useRestaurantSettings();
  const [searchParams] = useSearchParams();
  const routerLocation = useLocation();
  const handoffCustomer = (routerLocation.state as { customer?: CustomerHit } | null)?.customer ?? null;

  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [tables, setTables] = useState<TableWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pickerItem, setPickerItem] = useState<MenuItem | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [mobileOrderOpen, setMobileOrderOpen] = useState(false);

  const [orderType, setOrderType] = useState<OrderTypeSel>(() => (searchParams.get("table") ? "dine_in" : "pickup"));
  const [tableId, setTableId] = useState(() => searchParams.get("table") ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>("cash");
  const [promoCode, setPromoCode] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerHit | null>(handoffCustomer);
  const [walkIn, setWalkIn] = useState<WalkInDraft | null>(null);

  const [deliveryLine1, setDeliveryLine1] = useState("");
  const [deliveryCity, setDeliveryCity] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);

  useEffect(() => {
    // On a cold full-page load (refresh, direct link, bookmark) this effect can run once before
    // LocationContext finishes resolving activeLocationId, when useActiveLocationId()'s asserted
    // non-null value is still actually null — skip that pass rather than requesting
    // /restaurants/null/menu; the effect re-runs for real once the id resolves.
    if (!restaurantId) return;
    setLoading(true);
    Promise.all([
      apiClient.request<MenuResponse>(`/restaurants/${restaurantId}/menu`),
      apiClient.request<{ tables: TableWithStatus[] }>(`/restaurants/${restaurantId}/tables`).catch(() => ({ tables: [] })),
    ])
      .then(([menuRes, tableRes]) => {
        setMenu(menuRes);
        setTables(tableRes.tables.filter((t) => t.isActive));
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [restaurantId]);

  const modifierGroupsByItem = useMemo(() => {
    const map = new Map<string, ModifierGroup[]>();
    for (const group of menu?.modifierGroups ?? []) {
      const list = map.get(group.menuItemId) ?? [];
      list.push(group);
      map.set(group.menuItemId, list);
    }
    return map;
  }, [menu]);

  function addToCart(item: MenuItem, mods: SelectedModifier[], notes: string) {
    const key = lineKey(item.id, mods);
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key && (l.specialInstructions ?? "") === notes);
      if (existing) return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      return [
        ...prev,
        { key: `${key}::${prev.length}`, menuItemId: item.id, name: item.name, unitPrice: item.price, quantity: 1, selectedModifiers: mods, specialInstructions: notes || undefined },
      ];
    });
    setPickerItem(null);
  }

  function handleItemClick(item: MenuItem) {
    const groups = modifierGroupsByItem.get(item.id) ?? [];
    if (groups.length === 0) addToCart(item, [], "");
    else setPickerItem(item);
  }

  function updateQuantity(key: string, delta: number) {
    setCart((prev) => prev.flatMap((l) => (l.key === key ? (l.quantity + delta <= 0 ? [] : [{ ...l, quantity: l.quantity + delta }]) : [l])));
  }

  function resetSale() {
    setCart([]);
    setSelectedCustomer(null);
    setWalkIn(null);
    setTableId("");
    setPromoCode("");
    setCustomerNotes("");
    setDeliveryLine1("");
    setDeliveryCity("");
    setCompletedOrder(null);
    setSubmitError(null);
    setOrderType("pickup");
    setMobileOrderOpen(false);
  }

  async function handleSubmit() {
    setSubmitError(null);
    if (cart.length === 0) {
      setSubmitError("Add at least one item before completing the sale");
      return;
    }
    const customer = selectedCustomer
      ? { customerId: selectedCustomer.customerId }
      : walkIn
        ? { name: walkIn.name.trim() || "Walk-in", phone: walkIn.phone.trim() || undefined, email: walkIn.email.trim() || undefined }
        : null;
    if (!customer) {
      setSubmitError("Choose a customer to continue");
      setCustomerPickerOpen(true);
      return;
    }
    if (orderType === "dine_in" && !tableId) {
      setSubmitError("Select a table for a dine-in order");
      return;
    }
    if (orderType === "delivery" && (!deliveryLine1.trim() || !deliveryCity.trim())) {
      setSubmitError("Enter a delivery address");
      return;
    }

    setSubmitting(true);
    try {
      const { order } = await apiClient.request<{ order: Order }>(`/restaurants/${restaurantId}/pos/orders`, {
        method: "POST",
        body: {
          customer,
          items: cart.map((l) => ({
            menuItemId: l.menuItemId,
            quantity: l.quantity,
            selectedModifiers: l.selectedModifiers.map((m) => ({ groupId: m.groupId, optionId: m.optionId })),
            specialInstructions: l.specialInstructions,
          })),
          orderType,
          paymentMethod,
          tableId: orderType === "dine_in" ? tableId : undefined,
          deliveryAddress: orderType === "delivery" ? { line1: deliveryLine1, city: deliveryCity, latitude: 0, longitude: 0 } : undefined,
          customerNotes: customerNotes || undefined,
          promoCode: promoCode || undefined,
        },
      });
      setCompletedOrder(order);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full">
        <div className="flex-1 p-6">
          <Skeleton className="h-11 w-full max-w-md" />
          <div className="mt-4 grid grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[4/3]" />
            ))}
          </div>
        </div>
        <div className="w-[420px] shrink-0 border-l border-border p-5">
          <Skeleton className="h-8 w-32" />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6">
        <EmptyState title="Couldn't load the register" description={error} />
      </div>
    );
  }
  if (restaurant?.settings.posEnabled === false) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<IconRegister className="h-6 w-6" />}
          title="POS is not enabled for this location"
          description="Turn on the POS terminal under Settings → Ordering in Restaurant Admin to start ringing up in-person sales."
        />
      </div>
    );
  }
  if (completedOrder) return <CompletedSale order={completedOrder} onNewSale={resetSale} />;

  const customerLabel = selectedCustomer
    ? { name: selectedCustomer.name, detail: selectedCustomer.phone ?? selectedCustomer.email }
    : walkIn
      ? { name: walkIn.name || "Walk-in", detail: "Walk-in" }
      : null;

  const currency = restaurant?.settings.currency ?? "USD";
  const subtotal = cart.reduce((sum, l) => sum + lineTotal(l), 0);
  const itemCount = cart.reduce((n, l) => n + l.quantity, 0);

  const orderPanelSharedProps = {
    cart,
    currency,
    onUpdateQuantity: updateQuantity,
    customerLabel,
    onOpenCustomerPicker: () => setCustomerPickerOpen(true),
    orderType,
    onOrderTypeChange: setOrderType,
    tables,
    tableId,
    onTableChange: setTableId,
    deliveryLine1,
    deliveryCity,
    onDeliveryChange: (l: string, c: string) => {
      setDeliveryLine1(l);
      setDeliveryCity(c);
    },
    paymentMethod,
    onPaymentMethodChange: setPaymentMethod,
    promoCode,
    onPromoCodeChange: setPromoCode,
    customerNotes,
    onCustomerNotesChange: setCustomerNotes,
    submitting,
    submitError,
    onSubmit: handleSubmit,
  };

  return (
    <div className="relative flex h-full">
      {pickerItem && (
        <ModifierSheet
          item={pickerItem}
          groups={modifierGroupsByItem.get(pickerItem.id) ?? []}
          currency={restaurant?.settings.currency}
          onAdd={(mods, notes) => addToCart(pickerItem, mods, notes)}
          onClose={() => setPickerItem(null)}
        />
      )}
      {customerPickerOpen && (
        <CustomerPicker
          restaurantId={restaurantId}
          currency={currency}
          selectedCustomer={selectedCustomer}
          onSelectExisting={(c) => {
            setSelectedCustomer(c);
            setWalkIn(null);
            setCustomerPickerOpen(false);
          }}
          onContinueAsWalkIn={(draft) => {
            setWalkIn(draft);
            setSelectedCustomer(null);
            setCustomerPickerOpen(false);
          }}
          onClose={() => setCustomerPickerOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        <div className="border-b border-border px-4 py-2.5">
          <h1 className="text-sm font-semibold text-foreground">Register</h1>
          <p className="text-xs text-muted">Start an in-person sale, take payment, and send the order to the kitchen.</p>
        </div>
        <MenuBrowser
          categories={menu?.categories ?? []}
          items={menu?.items ?? []}
          currency={currency}
          onSelectItem={handleItemClick}
        />
      </div>

      {/* Desktop/tablet: the order panel is always visible, inline. */}
      <div className="hidden md:flex">
        <OrderPanel {...orderPanelSharedProps} />
      </div>

      {/* Mobile: a persistent bottom bar stands in for the panel, opening it as a full-screen
          sheet — preserves fast ordering (menu gets the full screen) while the order stays one
          tap away, per the "focused ordering flow" the phone-width case needs. */}
      {cart.length > 0 && (
        <button
          onClick={() => setMobileOrderOpen(true)}
          className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 bg-primary px-5 py-4 text-primary-foreground shadow-elevated md:hidden"
        >
          <span className="text-sm font-medium">
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
          <span className="font-heading text-base font-semibold">View order · {formatCurrency(subtotal, currency)}</span>
        </button>
      )}
      {mobileOrderOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <OrderPanel {...orderPanelSharedProps} onClose={() => setMobileOrderOpen(false)} />
        </div>
      )}
    </div>
  );
}
