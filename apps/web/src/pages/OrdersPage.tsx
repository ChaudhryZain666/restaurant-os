import { useEffect, useState } from "react";
import type { Order } from "@restaurant/types";
import { apiClient } from "../lib/api";

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  function reload() {
    return apiClient.request<{ orders: Order[] }>("/orders/mine").then((data) => setOrders(data.orders));
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  async function cancelOrder(orderId: string) {
    setCancellingId(orderId);
    setError(null);
    try {
      await apiClient.request(`/orders/${orderId}/cancel`, { method: "PATCH" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancellingId(null);
    }
  }

  if (loading) return <p>Loading orders...</p>;
  if (orders.length === 0) return <p>You haven't placed any orders yet.</p>;

  return (
    <div>
      <h1>My orders</h1>
      {error && <p role="alert">{error}</p>}
      <ul>
        {orders.map((order) => (
          <li key={order.id}>
            {order.orderNumber} — {order.status} — ${order.total.toFixed(2)} ({order.orderType}, {order.items.length}{" "}
            item{order.items.length === 1 ? "" : "s"})
            {order.status === "pending" && (
              <button onClick={() => cancelOrder(order.id)} disabled={cancellingId === order.id}>
                {cancellingId === order.id ? "Cancelling..." : "Cancel order"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
