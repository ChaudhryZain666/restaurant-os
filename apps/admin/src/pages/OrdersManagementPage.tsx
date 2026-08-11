import { Fragment, useEffect, useState } from "react";
import type { Order, OrderStatus, PaymentStatus } from "@restaurant/types";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// Mirrors the server's state machine (apps/api/src/services/orderStateMachine.ts) for the
// primary forward path only — the server is still the source of truth and will reject
// anything invalid regardless of what this map offers.
function nextForwardStatus(order: Order): OrderStatus | null {
  switch (order.status) {
    case "pending":
      return "confirmed";
    case "confirmed":
      return "preparing";
    case "preparing":
      return "ready";
    case "ready":
      return order.orderType === "delivery" ? "out_for_delivery" : "completed";
    case "out_for_delivery":
      return "completed";
    default:
      return null;
  }
}

function isCancellable(status: OrderStatus): boolean {
  return status !== "completed" && status !== "cancelled";
}

export function OrdersManagementPage() {
  const { user } = useAuth();
  const restaurantId = user!.restaurantId!;
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function reload() {
    const { orders } = await apiClient.request<{ orders: Order[] }>(`/restaurants/${restaurantId}/orders`);
    setOrders(orders);
  }

  useEffect(() => {
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function setStatus(order: Order, status: OrderStatus) {
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/orders/${order.id}/status`, {
        method: "PATCH",
        body: { status },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setPaymentStatus(order: Order, paymentStatus: PaymentStatus) {
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/orders/${order.id}/payment-status`, {
        method: "PATCH",
        body: { paymentStatus },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) return <p>Loading orders...</p>;
  if (orders.length === 0) return <p>No orders yet.</p>;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Orders</h1>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-2">Order #</th>
            <th>Customer</th>
            <th>Type</th>
            <th>Status</th>
            <th>Payment</th>
            <th>Total</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const next = nextForwardStatus(order);
            const expanded = expandedId === order.id;
            return (
              <Fragment key={order.id}>
                <tr className="border-b">
                  <td className="py-2">
                    <button
                      onClick={() => setExpandedId(expanded ? null : order.id)}
                      className="underline decoration-dotted"
                    >
                      {order.orderNumber}
                    </button>
                  </td>
                  <td>{order.customerName ?? "—"}</td>
                  <td>{order.orderType}</td>
                  <td>{order.status}</td>
                  <td>{order.paymentStatus}</td>
                  <td>${order.total.toFixed(2)}</td>
                  <td className="flex gap-2 py-2">
                    {next && (
                      <button
                        onClick={() => setStatus(order, next)}
                        className="rounded bg-slate-900 px-2 py-1 text-white"
                      >
                        Mark {next.replace(/_/g, " ")}
                      </button>
                    )}
                    {isCancellable(order.status) && (
                      <button onClick={() => setStatus(order, "cancelled")} className="text-red-600">
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b bg-slate-50">
                    <td colSpan={7} className="py-3">
                      <div className="flex flex-col gap-2 px-2">
                        <div className="flex flex-wrap gap-6 text-xs text-slate-600">
                          <span>Customer phone: {order.customerPhone ?? "—"}</span>
                          {order.deliveryAddress && <span>Delivery address: {order.deliveryAddress}</span>}
                          {order.customerNotes && <span>Notes: {order.customerNotes}</span>}
                        </div>
                        <ul className="flex flex-col gap-1">
                          {order.items.map((item, i) => (
                            <li key={i}>
                              {item.quantity} x {item.name}
                              {item.selectedModifiers.length > 0 && (
                                <span className="text-slate-500">
                                  {" "}
                                  ({item.selectedModifiers.map((m) => m.optionName).join(", ")})
                                </span>
                              )}{" "}
                              — ${item.lineTotal.toFixed(2)}
                            </li>
                          ))}
                        </ul>
                        <div className="text-xs text-slate-600">
                          Subtotal ${order.subtotal.toFixed(2)} · Tax ${order.taxAmount.toFixed(2)} · Delivery $
                          {order.deliveryFee.toFixed(2)}
                          {order.discount > 0 && <> · Discount -${order.discount.toFixed(2)}</>}
                        </div>
                        <div>
                          {order.paymentStatus === "unpaid" ? (
                            <button
                              onClick={() => setPaymentStatus(order, "paid")}
                              className="rounded border px-2 py-1 text-xs"
                            >
                              Mark as paid
                            </button>
                          ) : (
                            <button
                              onClick={() => setPaymentStatus(order, "unpaid")}
                              className="rounded border px-2 py-1 text-xs"
                            >
                              Mark as unpaid
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
