import { useEffect, useState } from "react";
import { Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { RefundRow, type StaffRefund } from "../components/PaymentRefunds";

type WaitingRefund = StaffRefund & { restaurantName: string | null; orderNumber: string | null; currency: string | null };

/**
 * Every refund across the platform that is on hold (the provider never confirmed it) or waiting on
 * the provider — the amount is reserved until it's settled. Platform admins can check a refund with
 * the provider; recording an outcome by hand stays with the restaurant's own staff
 * (restaurant.payments.manage), on the order's payment panel.
 */
export function PlatformRefundsPage() {
  const [refunds, setRefunds] = useState<WaitingRefund[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const { refunds } = await apiClient.request<{ refunds: WaitingRefund[] }>("/platform/refunds/waiting");
      setRefunds(refunds);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const held = refunds?.filter((r) => r.reconciliation.held).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Waiting refunds</h1>
        <p className="text-sm text-muted">
          Refunds the provider hasn't confirmed yet. Their amounts stay reserved, so nothing can be refunded twice. Oldest first.
        </p>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {refunds && refunds.length === 0 && (
        <Card>
          <p className="text-sm text-muted">Nothing waiting — every refund is settled.</p>
        </Card>
      )}
      {refunds && refunds.length > 0 && (
        <>
          <p className="text-sm text-foreground">
            {refunds.length} waiting{held > 0 ? ` · ${held} on hold` : ""}
          </p>
          {refunds.map((refund) => (
            <Card key={refund.id} className="flex flex-col gap-2">
              <p className="text-sm text-foreground">
                {refund.restaurantName ?? "Unknown restaurant"}
                {refund.orderNumber ? ` · Order ${refund.orderNumber}` : ""}
              </p>
              <RefundRow
                refund={refund}
                currency={refund.currency ?? "USD"}
                path={`/platform/refunds/${refund.id}`}
                onChanged={load}
                allowManual={false}
              />
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
