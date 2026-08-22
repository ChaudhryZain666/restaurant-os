import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Order } from "@restaurant/types";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";

/**
 * Phase 14 — customer-facing printable receipt. Mirrors apps/admin's PrintOrderPage (same data
 * shape, same browser-print approach — no Layout wrapper, see App.tsx) but customer-only: no
 * kitchen-ticket mode, and GET /orders/:id already strips internalNote for a non-staff caller
 * (see order.controller.ts's stripInternalFields), so there's nothing extra to filter here.
 */
export function PrintReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .request<{ order: Order }>(`/orders/${id}`)
      .then((data) => setOrder(data.order))
      .catch((err) => setError((err as Error).message));
  }, [id]);

  useEffect(() => {
    if (order) {
      const t = setTimeout(() => window.print(), 150);
      return () => clearTimeout(t);
    }
  }, [order]);

  if (error) return <p className="p-6 text-danger">{error}</p>;
  if (!order) return <p className="p-6 text-muted">Loading...</p>;

  return (
    <div className="mx-auto max-w-sm p-6 font-mono text-sm text-black">
      <div className="mb-3 text-center">
        <p className="text-base font-bold">{order.restaurantName ?? "Restaurant"}</p>
        {order.restaurantAddress && <p className="text-xs">{order.restaurantAddress}</p>}
        {order.restaurantPhone && <p className="text-xs">{order.restaurantPhone}</p>}
      </div>
      <hr className="my-2 border-dashed border-black" />
      <p className="font-bold">RECEIPT</p>
      <p>Order #{order.orderNumber}</p>
      <p>{new Date(order.createdAt).toLocaleString()}</p>
      <p className="capitalize">
        {order.orderType.replace("_", " ")}
        {order.orderType === "dine_in" && order.tableName ? ` — ${order.tableName}` : ""}
      </p>
      <hr className="my-2 border-dashed border-black" />
      <ul className="flex flex-col gap-1.5">
        {order.items.map((item, i) => (
          <li key={i}>
            <div className="flex justify-between">
              <span>
                {item.quantity} x {item.name}
              </span>
              <span>{formatCurrency(item.lineTotal, order.currency)}</span>
            </div>
            {item.selectedModifiers.length > 0 && (
              <p className="pl-3 text-xs">{item.selectedModifiers.map((m) => m.optionName).join(", ")}</p>
            )}
          </li>
        ))}
      </ul>
      <hr className="my-2 border-dashed border-black" />
      <div className="flex flex-col gap-0.5">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatCurrency(order.subtotal, order.currency)}</span>
        </div>
        {order.discount > 0 && (
          <div className="flex justify-between">
            <span>Discount{order.promoCode ? ` (${order.promoCode})` : ""}</span>
            <span>-{formatCurrency(order.discount, order.currency)}</span>
          </div>
        )}
        {order.deliveryFee > 0 && (
          <div className="flex justify-between">
            <span>Delivery fee</span>
            <span>{formatCurrency(order.deliveryFee, order.currency)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Tax</span>
          <span>{formatCurrency(order.taxAmount, order.currency)}</span>
        </div>
        <div className="flex justify-between font-bold">
          <span>Total</span>
          <span>{formatCurrency(order.total, order.currency)}</span>
        </div>
      </div>
      <hr className="my-2 border-dashed border-black" />
      <p className="capitalize">
        {order.paymentMethod === "online" ? `Paid online · ${order.paymentStatus}` : `Cash · ${order.paymentStatus}`}
      </p>
      <p className="mt-4 text-center text-xs">Thank you!</p>
    </div>
  );
}
