import { useEffect, useState } from "react";
import type { Order } from "@restaurant/types";
import { apiClient } from "../lib/api";

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .request<{ orders: Order[] }>("/orders/mine")
      .then((data) => setOrders(data.orders))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading orders...</p>;
  if (orders.length === 0) return <p>You haven't placed any orders yet.</p>;

  return (
    <div>
      <h1>My orders</h1>
      <ul>
        {orders.map((order) => (
          <li key={order.id}>
            Order {order.id.slice(-6)} — {order.status} — ${order.total.toFixed(2)} (
            {order.items.length} item{order.items.length === 1 ? "" : "s"})
          </li>
        ))}
      </ul>
    </div>
  );
}
