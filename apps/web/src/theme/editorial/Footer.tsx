import type { FooterProps } from "../types";

/** Editorial — generous whitespace, centered, small caps — quiet like the rest of the theme. */
export function EditorialFooter({ restaurant, hideBranding }: FooterProps) {
  return (
    <footer className="border-t border-border px-4 py-10 text-center sm:px-6">
      <p className="font-heading text-lg italic text-foreground">{restaurant?.name ?? "Restaurant"}</p>
      {!hideBranding && <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-muted">Powered by a platform built for real restaurants</p>}
    </footer>
  );
}
