import type { Order } from "@restaurant/types";
import { Button } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { IconCheck } from "../../components/icons";

export function CompletedSale({ order, onNewSale }: { order: Order; onNewSale: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success">
        <IconCheck className="h-8 w-8" />
      </span>
      <div>
        <h1 className="font-heading text-3xl font-semibold text-foreground">Order #{order.orderNumber}</h1>
        <p className="mt-1 text-muted">
          {formatCurrency(order.total, order.currency)} · {order.paymentMethod === "cash" ? "Cash" : "Card"}
        </p>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => window.open(`/print/receipt/${order.id}`, "_blank", "noopener")}>
          Print receipt
        </Button>
        <Button size="lg" onClick={onNewSale}>
          New sale
        </Button>
      </div>
    </div>
  );
}
