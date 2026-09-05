import { useEffect, useState } from "react";
import type { Delivery, DeliveryStatus, Order } from "@restaurant/types";
import { Alert, Badge, Button } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: "Requesting courier...",
  quoted: "Quote received",
  requested: "Courier requested",
  accepted: "Accepted",
  driver_assigned: "Driver assigned",
  picked_up: "Picked up",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  failed: "Failed — needs attention",
};

const STATUS_TONE: Record<DeliveryStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  pending: "neutral",
  quoted: "neutral",
  requested: "info",
  accepted: "info",
  driver_assigned: "info",
  picked_up: "success",
  out_for_delivery: "success",
  delivered: "success",
  cancelled: "danger",
  failed: "danger",
};

/** The one manual-dispatch-reachable status this restaurant's own rider can advance to next —
 *  mirrors updateManualDeliverySchema's allowed enum, in order. */
const MANUAL_NEXT: Partial<Record<DeliveryStatus, DeliveryStatus>> = {
  accepted: "driver_assigned",
  driver_assigned: "picked_up",
  picked_up: "out_for_delivery",
  out_for_delivery: "delivered",
};

const CANCELLABLE: DeliveryStatus[] = ["pending", "quoted", "requested", "accepted", "driver_assigned"];

/**
 * Phase 40 — a delivery order's courier-dispatch status/tracking, shown alongside the order's own
 * status (unchanged). Provider-agnostic by construction: renders exactly the same for "manual" and
 * "uber_direct" (only the action buttons differ — a third-party delivery's status only ever moves
 * via its own webhook, never a manual override, see deliveryDispatch.controller.ts). Used by both
 * OrdersManagementPage (admin) and the POS order panel — one component, not two copies.
 */
export function DeliveryStatusPanel({ order }: { order: Order }) {
  const restaurantId = useActiveLocationId();
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const res = await apiClient.request<{ delivery: Delivery | null }>(`/restaurants/${restaurantId}/orders/${order.id}/delivery`);
    setDelivery(res.delivery);
  }

  useEffect(() => {
    if (order.orderType !== "delivery") return;
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  if (order.orderType !== "delivery") return null;
  if (loading) return <p className="text-xs text-muted">Loading delivery status...</p>;
  if (!delivery) {
    return <p className="text-xs text-muted">Courier will be requested once this order is marked ready.</p>;
  }

  const nextManualStatus = delivery.provider === "manual" ? MANUAL_NEXT[delivery.status] : undefined;

  async function advance(status: DeliveryStatus) {
    setBusy(true);
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/orders/${order.id}/delivery/manual-status`, {
        method: "POST",
        body: { status },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/orders/${order.id}/delivery/cancel`, { method: "POST", body: {} });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/orders/${order.id}/delivery/retry`, { method: "POST" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-border bg-background p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground capitalize">{delivery.provider === "manual" ? "Your own delivery" : delivery.provider.replace("_", " ")}</span>
        <Badge tone={STATUS_TONE[delivery.status]}>{STATUS_LABELS[delivery.status]}</Badge>
      </div>
      {delivery.courierName && <span className="text-muted">Courier: {delivery.courierName}{delivery.courierPhone ? ` · ${delivery.courierPhone}` : ""}</span>}
      {delivery.trackingUrl && (
        <a href={delivery.trackingUrl} target="_blank" rel="noreferrer" className="text-primary underline">
          Track delivery
        </a>
      )}
      {delivery.status === "failed" && delivery.failureReason && <span className="text-danger">{delivery.failureReason}</span>}
      {error && <Alert tone="danger" role="alert">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {nextManualStatus && (
          <Button type="button" size="sm" disabled={busy} onClick={() => advance(nextManualStatus)}>
            Mark {STATUS_LABELS[nextManualStatus].toLowerCase()}
          </Button>
        )}
        {delivery.status === "failed" && (
          <Button type="button" size="sm" disabled={busy} onClick={retry}>
            Retry
          </Button>
        )}
        {CANCELLABLE.includes(delivery.status) && (
          <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={cancel}>
            Cancel delivery
          </Button>
        )}
      </div>
    </div>
  );
}
