import type { FooterProps } from "../types";

/** Modern — a full-bleed dark band, bold uppercase wordmark, no rounded shapes. */
export function ModernFooter({ restaurant, hideBranding }: FooterProps) {
  return (
    <footer className="border-t-2 border-foreground bg-secondary px-4 py-8 text-center sm:px-6">
      <p className="text-sm font-black uppercase tracking-[0.14em] text-secondary-foreground">{restaurant?.name ?? "Restaurant"}</p>
      {!hideBranding && <p className="mt-1 text-xs uppercase tracking-wide text-secondary-foreground/50">Powered by a platform built for real restaurants</p>}
    </footer>
  );
}
