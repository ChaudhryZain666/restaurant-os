import type { FooterProps } from "../types";

export function ClassicFooter({ restaurant, hideBranding }: FooterProps) {
  return (
    <footer className="border-t border-border px-4 py-6 text-center text-sm text-muted sm:px-6">
      {hideBranding ? (
        <p>{restaurant?.name ?? "Restaurant"}</p>
      ) : (
        <p>{restaurant?.name ?? "Restaurant"} · Powered by a platform built for real restaurants, not a website builder.</p>
      )}
    </footer>
  );
}
