import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { Order, ReorderPreview } from "@restaurant/types";
import { Alert, Badge, Button, Card, Skeleton } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useCart } from "../context/CartContext";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "../lib/orderStatus";
import { OrderStatusTimeline } from "../components/OrderStatusTimeline";
import { OrderPaymentPanel } from "../components/OrderPaymentPanel";
import { useOrderEvents } from "../hooks/useOrderEvents";
import { useSocketStatus } from "../hooks/useSocketStatus";
import { useNoIndex } from "../hooks/useNoIndex";

const ORDER_TYPE_LABELS: Record<Order["orderType"], string> = {
  pickup: "Pickup",
  delivery: "Delivery",
  dine_in: "Dine-in",
};

export function OrderDetailPage() {
  useNoIndex();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { loadFromReorder } = useCart();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [reorderNotice, setReorderNotice] = useState<string | null>(null);

  const justPlaced = Boolean((location.state as { justPlaced?: boolean } | null)?.justPlaced);

  function reload() {
    return apiClient.request<{ order: Order }>(`/orders/${id}`).then((data) => setOrder(data.order));
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const socketStatus = useSocketStatus();
  // A socket event is a "something changed, go check" signal, never applied as state directly —
  // re-fetching here is what actually keeps this page correct, including after a missed event.
  // Debounced: a burst of events (e.g. payment confirmation immediately followed by a status
  // change) shouldn't fire a reload per event.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const debouncedReload = useCallback(() => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      reload().catch(() => {
        // A background refresh failing silently is fine — the next event or manual action retries.
      });
    }, 400);
  }, []);
  useOrderEvents(debouncedReload, id);

  async function cancelOrder() {
    setCancelling(true);
    setError(null);
    try {
      await apiClient.request(`/orders/${id}/cancel`, { method: "PATCH" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancelling(false);
    }
  }

  async function reorder() {
    setReordering(true);
    setReorderNotice(null);
    setError(null);
    try {
      const preview = await apiClient.request<ReorderPreview>(`/orders/${id}/reorder`, { method: "POST" });
      if (preview.items.length === 0) {
        setReorderNotice("None of the items in this order are available to reorder right now.");
        return;
      }
      if (!preview.restaurantSlug) {
        setReorderNotice("This restaurant is no longer available to reorder from.");
        return;
      }
      loadFromReorder(preview.items, preview.restaurantId);
      const cartPath = `/r/${preview.restaurantSlug}/cart`;
      if (preview.unavailableItems.length > 0) {
        navigate(cartPath, {
          state: {
            reorderNotice: `Some items couldn't be added: ${preview.unavailableItems.map((i) => i.name).join(", ")}.`,
          },
        });
      } else {
        navigate(cartPath);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReordering(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (error && !order) {
    return (
      <Alert tone="danger" role="alert" className="mx-auto max-w-2xl">
        {error}
      </Alert>
    );
  }

  if (!order) return null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {justPlaced && (
        <Alert tone="success" className="animate-scale-in">
          <div>
            <p className="font-medium">Order placed successfully!</p>
            <p className="text-sm">
              {order.paymentMethod === "online" && order.paymentStatus !== "paid"
                ? "Complete payment below to send it to the kitchen."
                : "We'll keep this page updated as the restaurant works on it."}
            </p>
          </div>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-semibold text-foreground">Order {order.orderNumber}</h1>
          <p className="flex items-center gap-1.5 text-sm text-muted">
            {new Date(order.createdAt).toLocaleString()}
            {socketStatus !== "connected" && order.status !== "completed" && order.status !== "cancelled" && (
              <span className="text-xs text-muted" title="Live updates are reconnecting — this page will catch up automatically.">
                · reconnecting…
              </span>
            )}
          </p>
        </div>
        <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
      </div>

      <button
        onClick={() => window.open(`/orders/${order.id}/receipt`, "_blank", "noopener")}
        className="self-start text-sm font-medium text-primary hover:underline"
      >
        Print receipt
      </button>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {reorderNotice && (
        <Alert tone="warning" role="alert">
          {reorderNotice}
        </Alert>
      )}

      <Card>
        <OrderStatusTimeline order={order} />
      </Card>

      {order.paymentMethod === "online" && <OrderPaymentPanel order={order} onOrderUpdated={reload} />}

      <Card className="flex flex-col gap-2">
        <h2 className="font-medium text-foreground">Items</h2>
        <ul className="flex flex-col divide-y divide-border">
          {order.items.map((item, i) => (
            <li key={i} className="flex flex-col gap-0.5 py-2 text-sm first:pt-0 last:pb-0">
              <div className="flex justify-between">
                <span>
                  {item.quantity} x {item.name}
                  {item.selectedModifiers.length > 0 && (
                    <span className="text-muted"> ({item.selectedModifiers.map((m) => m.optionName).join(", ")})</span>
                  )}
                </span>
                <span className="text-foreground">{formatCurrency(item.lineTotal, order.currency)}</span>
              </div>
              {item.specialInstructions && <p className="text-xs italic text-muted">"{item.specialInstructions}"</p>}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-sm text-muted">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatCurrency(order.subtotal, order.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span>Tax</span>
            <span>{formatCurrency(order.taxAmount, order.currency)}</span>
          </div>
          {order.deliveryFee > 0 && (
            <div className="flex justify-between">
              <span>Delivery fee</span>
              <span>{formatCurrency(order.deliveryFee, order.currency)}</span>
            </div>
          )}
          {order.discount > 0 && (
            <div className="flex justify-between">
              <span>Discount</span>
              <span>-{formatCurrency(order.discount, order.currency)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold text-foreground">
            <span>Total</span>
            <span>{formatCurrency(order.total, order.currency)}</span>
          </div>
        </div>
      </Card>

      <Card className="flex flex-col gap-1 text-sm text-muted">
        <div className="flex justify-between">
          <span>Order type</span>
          <span>{ORDER_TYPE_LABELS[order.orderType]}</span>
        </div>
        {order.orderType === "dine_in" && order.tableName && (
          <div className="flex justify-between">
            <span>Table</span>
            <span className="text-foreground">{order.tableName}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Payment method</span>
          <span className="capitalize">
            {order.paymentMethod === "online" ? "Online" : order.paymentMethod === "card" ? "Card" : "Cash"}
          </span>
        </div>
        {order.paymentMethod !== "online" && (
          <div className="flex justify-between">
            <span>Payment</span>
            <span className="capitalize">{order.paymentStatus}</span>
          </div>
        )}
        {order.deliveryAddress && (
          <>
            <div className="flex justify-between gap-4">
              <span>Delivery address</span>
              <span className="text-right text-foreground">
                {[
                  order.deliveryAddress.line1,
                  order.deliveryAddress.line2,
                  order.deliveryAddress.city,
                  order.deliveryAddress.state,
                  order.deliveryAddress.postalCode,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </div>
            {order.deliveryDistanceKm != null && (
              <div className="flex justify-between">
                <span>Distance</span>
                <span className="text-foreground">{order.deliveryDistanceKm}km</span>
              </div>
            )}
            {order.deliveryAddress.instructions && (
              <div className="flex justify-between gap-4">
                <span>Delivery instructions</span>
                <span className="text-right text-foreground">{order.deliveryAddress.instructions}</span>
              </div>
            )}
          </>
        )}
        {order.customerNotes && (
          <div className="flex justify-between gap-4">
            <span>Notes</span>
            <span className="text-right">{order.customerNotes}</span>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={reorder} disabled={reordering}>
          {reordering ? "Preparing..." : "Order again"}
        </Button>
        {order.status === "pending" && (
          <Button variant="destructive" onClick={cancelOrder} disabled={cancelling}>
            {cancelling ? "Cancelling..." : "Cancel order"}
          </Button>
        )}
        <Link to="/orders" className="ml-auto text-sm font-medium text-muted underline decoration-dotted underline-offset-2 hover:text-foreground">
          Back to order history
        </Link>
      </div>
    </div>
  );
}
