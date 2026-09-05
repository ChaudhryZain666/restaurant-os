import { Badge } from "@restaurant/ui";
import { AnimatedNumber } from "./AnimatedNumber";

/**
 * Realistic, clearly-illustrative UI mockups for the Product page — built from the actual admin
 * and storefront layouts/copy, not photos or a real authenticated session (there's nothing safe
 * to embed live for owner-only screens on a public page). Every mock reuses real menu items,
 * real order-number formats, and real feature names from this codebase, not invented ones.
 */

export const MockFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated">
    <div className="flex items-center gap-1.5 border-b border-border bg-background px-4 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
      <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
      <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
    </div>
    <div className="flex-1">{children}</div>
  </div>
);

export function DashboardMock() {
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Revenue today", value: 1284, format: (n: number) => `$${Math.round(n).toLocaleString()}` },
          { label: "Orders today", value: 47 },
          { label: "Avg. order value", value: 27.3, format: (n: number) => `$${n.toFixed(2)}` },
          { label: "Active orders", value: 6 },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border bg-surface p-3">
            <p className="text-xs text-muted">{stat.label}</p>
            <p className="font-heading text-xl font-semibold text-foreground">
              <AnimatedNumber value={stat.value} format={stat.format} />
            </p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="mb-3 text-xs font-medium text-muted">Order status distribution</p>
        <div className="flex flex-col gap-2">
          {[
            { label: "New", value: 3 },
            { label: "Preparing", value: 5 },
            { label: "Ready", value: 2 },
            { label: "Completed", value: 37 },
          ].map((row) => (
            <div key={row.label} className="flex items-center gap-3 text-xs">
              <span className="w-16 shrink-0 text-muted">{row.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/[0.05]">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(row.value / 37) * 100}%` }} />
              </div>
              <span className="w-5 shrink-0 text-right font-medium text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Fills out the rest of this screen's box (previously left as bare empty space below the
          two cards above) with genuinely distinct content — a live-feeling recent-activity ticker,
          denser/differently formatted than OrdersMock's own card list so the two don't read as
          the same screen when shown side by side in ProductShowcase's preview thumbnails. */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="mb-3 text-xs font-medium text-muted">Recent activity</p>
        <div className="flex flex-col divide-y divide-border">
          {[
            { number: "ORD-1042", detail: "New pickup order", total: "$19.50", time: "just now" },
            { number: "ORD-1041", detail: "Delivery order accepted", total: "$24.00", time: "4 min ago" },
            { number: "ORD-1039", detail: "Order completed", total: "$31.20", time: "12 min ago" },
          ].map((row) => (
            <div key={row.number} className="flex items-center justify-between gap-3 py-2 text-xs first:pt-0 last:pb-0">
              <div className="min-w-0">
                <span className="font-medium text-foreground">{row.number}</span>{" "}
                <span className="text-muted">— {row.detail}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-medium text-foreground">{row.total}</span>
                <span className="text-muted">{row.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MenuMock() {
  const items = [
    { name: "Margherita Pizza", price: "$12.50", tag: "Available" },
    { name: "Pepperoni Pizza", price: "$14.00", tag: "Available" },
    { name: "Caesar Salad", price: "$8.50", tag: "Available" },
    { name: "Tiramisu", price: "$6.00", tag: "86'd today" },
  ];
  return (
    <div className="flex flex-col gap-2 p-5">
      {items.map((item) => (
        <div key={item.name} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-2.5">
          <div className="h-11 w-11 shrink-0 rounded-md bg-gradient-to-br from-primary/15 to-accent/15" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{item.name}</p>
            <p className="text-xs text-muted">{item.price}</p>
          </div>
          <Badge tone={item.tag === "Available" ? "success" : "warning"}>{item.tag}</Badge>
        </div>
      ))}
    </div>
  );
}

export function ModifierMock() {
  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
        <div className="h-12 w-12 shrink-0 rounded-md bg-gradient-to-br from-primary/15 to-accent/15" />
        <div>
          <p className="text-sm font-medium text-foreground">Margherita Pizza</p>
          <p className="text-xs text-muted">Tomato, mozzarella, basil — from $12.50</p>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-foreground">Size</p>
          <Badge tone="warning">Required · pick 1</Badge>
        </div>
        {[
          { label: "Small", price: "+$0.00", checked: true },
          { label: "Medium", price: "+$2.00", checked: false },
          { label: "Large", price: "+$4.00", checked: false },
        ].map((o) => (
          <label key={o.label} className="flex items-center justify-between py-1 text-sm text-foreground/80">
            <span className="flex items-center gap-2">
              <span className={`h-3.5 w-3.5 rounded-full border-2 ${o.checked ? "border-primary bg-primary" : "border-border"}`} />
              {o.label}
            </span>
            <span className="text-muted">{o.price}</span>
          </label>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-foreground">Extra toppings</p>
          <Badge tone="neutral">Optional · up to 3</Badge>
        </div>
        {[
          { label: "Extra cheese", price: "+$1.50" },
          { label: "Mushrooms", price: "+$1.00" },
        ].map((o) => (
          <label key={o.label} className="flex items-center justify-between py-1 text-sm text-foreground/80">
            <span className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 rounded border-2 border-border" />
              {o.label}
            </span>
            <span className="text-muted">{o.price}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function OrdersMock() {
  const orders = [
    { number: "ORD-1042", status: "New", tone: "warning" as const, items: "2 items · Pickup" },
    { number: "ORD-1041", status: "Preparing", tone: "info" as const, items: "1 item · Delivery" },
    { number: "ORD-1039", status: "Ready", tone: "success" as const, items: "3 items · Pickup" },
  ];
  return (
    <div className="flex flex-col gap-2 p-5">
      {orders.map((order) => (
        <div key={order.number} className="flex items-center justify-between rounded-lg border border-border bg-surface p-3">
          <div>
            <p className="text-sm font-medium text-foreground">{order.number}</p>
            <p className="text-xs text-muted">{order.items}</p>
          </div>
          <Badge tone={order.tone}>{order.status}</Badge>
        </div>
      ))}
    </div>
  );
}

export function DeliveryMock() {
  return (
    <div className="flex flex-col gap-3 p-5">
      {[
        { label: "Pickup", desc: "Customers collect in person", on: true },
        { label: "Delivery", desc: "Brought to the customer", on: true },
      ].map((row) => (
        <div key={row.label} className="flex items-center justify-between rounded-lg border border-border bg-surface p-3">
          <div>
            <p className="text-sm font-medium text-foreground">{row.label}</p>
            <p className="text-xs text-muted">{row.desc}</p>
          </div>
          <span className={`flex h-5 w-9 items-center rounded-full p-0.5 ${row.on ? "justify-end bg-primary" : "justify-start bg-black/10"}`}>
            <span className="h-4 w-4 rounded-full bg-white shadow" />
          </span>
        </div>
      ))}
      <div className="rounded-lg border border-border bg-surface p-3">
        <p className="text-xs text-muted">Delivery fee</p>
        <p className="font-heading text-lg font-semibold text-foreground">$3.50</p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-3">
        <p className="text-xs text-muted">Minimum order</p>
        <p className="font-heading text-lg font-semibold text-foreground">$15.00</p>
      </div>
    </div>
  );
}

export function CustomersMock() {
  const customers = [
    { name: "Jordan Lee", orders: 12, spent: "$284.50" },
    { name: "Priya Patel", orders: 8, spent: "$156.20" },
    { name: "Riley Chen", orders: 3, spent: "$61.00" },
  ];
  return (
    <div className="flex flex-col gap-2 p-5">
      {customers.map((c) => (
        <div key={c.name} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary font-heading text-xs font-semibold text-secondary-foreground">
            {c.name[0]}
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{c.name}</p>
            <p className="text-xs text-muted">{c.orders} orders</p>
          </div>
          <span className="text-sm font-medium text-foreground">{c.spent}</span>
        </div>
      ))}
    </div>
  );
}

export function PromotionsMock() {
  const promos = [
    { code: "WELCOME10", desc: "10% off, min. $15", status: "Active" },
    { code: "FREESHIP", desc: "$3.50 off delivery", status: "Active" },
  ];
  return (
    <div className="flex flex-col gap-2 p-5">
      {promos.map((p) => (
        <div key={p.code} className="flex items-center justify-between rounded-lg border border-border bg-surface p-3">
          <div>
            <p className="font-mono text-sm font-semibold text-primary">{p.code}</p>
            <p className="text-xs text-muted">{p.desc}</p>
          </div>
          <Badge tone="success">{p.status}</Badge>
        </div>
      ))}
      <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted">
        + New promotion
      </div>
    </div>
  );
}

export function AnalyticsMock() {
  const items = [
    { name: "Margherita Pizza", sold: 38 },
    { name: "Classic Burger", sold: 29 },
    { name: "Caesar Salad", sold: 21 },
  ];
  const max = Math.max(...items.map((i) => i.sold));
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "This week", value: "$8,420" },
          { label: "Orders", value: "312" },
          { label: "Avg. order", value: "$27.00" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-surface p-3">
            <p className="text-xs text-muted">{s.label}</p>
            <p className="font-heading text-lg font-semibold text-foreground">{s.value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="mb-3 text-xs font-medium text-muted">Top sellers this week</p>
        <div className="flex flex-col gap-2">
          {items.map((i) => (
            <div key={i.name} className="flex items-center gap-3 text-xs">
              <span className="w-28 shrink-0 truncate text-muted">{i.name}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/[0.05]">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(i.sold / max) * 100}%` }} />
              </div>
              <span className="w-6 shrink-0 text-right font-medium text-foreground">{i.sold}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LoyaltyMock() {
  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">Jordan Lee</p>
          <Badge tone="warning">Gold</Badge>
        </div>
        <p className="font-heading text-2xl font-semibold text-foreground">2,140 pts</p>
        <p className="text-xs text-muted">1 point per $1 spent · redeemable at checkout</p>
      </div>
      <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-3 text-xs">
        <div className="flex justify-between">
          <span className="text-foreground">Order placed</span>
          <span className="font-medium text-success">+28 pts</span>
        </div>
        <div className="flex justify-between">
          <span className="text-foreground">Redeemed on order</span>
          <span className="font-medium text-warning">-50 pts</span>
        </div>
      </div>
    </div>
  );
}

export function BrandingMock() {
  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="mb-2 text-xs text-muted">Brand color</p>
        <div className="flex items-center gap-2">
          {["#c2410c", "#0f766e", "#7c3aed", "#be123c"].map((c, i) => (
            <span
              key={c}
              className={`h-8 w-8 rounded-full border-2 ${i === 0 ? "border-foreground" : "border-transparent"}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="h-16 bg-gradient-to-br from-primary to-accent" />
        <div className="flex items-center gap-2 p-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">D</span>
          <p className="text-sm font-medium text-foreground">Demo Restaurant</p>
        </div>
      </div>
    </div>
  );
}

export function SupportMock() {
  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="rounded-lg border border-border bg-surface p-3">
        <p className="text-xs text-muted">Search help articles...</p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-3">
        <p className="text-sm font-medium text-foreground">#TKT-1394 — Order arrived missing an item</p>
        <div className="mt-2 flex flex-col gap-2 text-xs">
          <p className="rounded-lg bg-black/[0.03] p-2 text-foreground/80">"One of my sides didn't arrive."</p>
          <p className="ml-6 rounded-lg bg-primary/10 p-2 text-foreground/80">"Sorry about that — refunding now."</p>
        </div>
        <Badge tone="success" className="mt-2">Resolved</Badge>
      </div>
    </div>
  );
}

export function AgencyMock() {
  const businesses = [
    { name: "Ember & Oak", locations: 2, status: "Active" },
    { name: "Riverside Deli", locations: 1, status: "Active" },
    { name: "Casa Marisol", locations: 1, status: "Needs setup" },
  ];
  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="rounded-lg border border-border bg-surface p-3">
        <p className="text-xs text-muted">Businesses</p>
        <p className="font-heading text-xl font-semibold text-foreground">3 / 5</p>
      </div>
      <div className="flex flex-col gap-2">
        {businesses.map((b) => (
          <div key={b.name} className="flex items-center justify-between rounded-lg border border-border bg-surface p-3">
            <div>
              <p className="text-sm font-medium text-foreground">{b.name}</p>
              <p className="text-xs text-muted">{b.locations} location{b.locations > 1 ? "s" : ""}</p>
            </div>
            <Badge tone={b.status === "Active" ? "success" : "warning"}>{b.status}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CheckoutMock() {
  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between p-3 text-sm">
          <div>
            <p className="font-medium text-foreground">Margherita Pizza</p>
            <p className="text-xs text-muted">Medium (+$2.00)</p>
          </div>
          <span className="text-foreground">$14.50</span>
        </div>
        <div className="flex items-center justify-between p-3 text-sm">
          <p className="font-medium text-foreground">Coke — Large</p>
          <span className="text-foreground">$3.00</span>
        </div>
      </div>
      <div className="rounded-lg border border-success/30 bg-success/5 p-2.5 text-xs">
        <span className="font-mono font-semibold text-success">WELCOME10</span> applied — -$1.75
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-sm font-medium">
        <span className="text-foreground">Total</span>
        <span className="text-foreground">$17.19</span>
      </div>
    </div>
  );
}
