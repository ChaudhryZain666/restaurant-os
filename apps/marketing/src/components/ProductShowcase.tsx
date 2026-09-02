import { useState } from "react";
import { Reveal } from "@restaurant/ui";
import { STOREFRONT_URL } from "../lib/links";
import { IconCart, IconChart, IconClipboard, IconMenuBook } from "./icons";
import { DashboardMock, MenuMock, OrdersMock } from "./FeatureMocks";

/**
 * A tabbed "what the product looks like" showcase. The Dashboard/Menu/Orders tabs are static,
 * clearly-illustrative mockups (not live authenticated data — there's nothing to safely embed on
 * a public marketing page for those), while the "Customer Menu" tab embeds the REAL running
 * storefront in an iframe, since that page is public and this is the most honest way to show it:
 * it's not a mockup, it's the actual product.
 */

const BROWSER_CHROME = (
  <div className="flex items-center gap-1.5 border-b border-border bg-background px-4 py-2.5">
    <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
    <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
    <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
  </div>
);

const TABS = [
  { id: "dashboard", label: "Owner Dashboard", icon: IconChart, render: DashboardMock },
  { id: "menu", label: "Menu Management", icon: IconMenuBook, render: MenuMock },
  { id: "orders", label: "Orders", icon: IconClipboard, render: OrdersMock },
  { id: "storefront", label: "Customer Menu", icon: IconCart, render: null },
] as const;

export function ProductShowcase() {
  const [active, setActive] = useState<(typeof TABS)[number]["id"]>("dashboard");
  const activeTab = TABS.find((t) => t.id === active)!;

  return (
    <Reveal variant="scale" className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-center gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`flex items-center gap-2 rounded-pill border px-4 py-2 text-sm font-medium transition-colors duration-fast ${
              active === tab.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface text-foreground/80 hover:bg-black/[0.03]"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated">
        {BROWSER_CHROME}
        {activeTab.id === "storefront" ? (
          <div className="relative h-[520px] w-full bg-background">
            <iframe
              src={STOREFRONT_URL}
              title="Live demo restaurant storefront"
              className="h-full w-full border-0"
              loading="lazy"
            />
          </div>
        ) : (
          activeTab.render && <activeTab.render />
        )}
      </div>
      {activeTab.id === "storefront" && (
        <p className="text-center text-xs text-muted">
          This is the real, live demo restaurant — not a mockup. If it doesn't load, the storefront app may not be
          running locally.
        </p>
      )}
    </Reveal>
  );
}
