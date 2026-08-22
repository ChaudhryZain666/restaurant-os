const STOREFRONT_ORIGIN = import.meta.env.VITE_STOREFRONT_URL ?? "http://localhost:5173";

/** The customer storefront's real, public URL for this restaurant — only valid once published. */
export function storefrontUrl(slug: string): string {
  return `${STOREFRONT_ORIGIN}/r/${slug}`;
}

/** An authenticated, read-only preview of the storefront — works even while the restaurant is
 *  still pending (see restaurant.controller.ts's previewRestaurantBySlug). Opened in a new tab;
 *  the owner must already be logged into apps/web with the SAME account for it to resolve, since
 *  the preview endpoint is tenant-scoped to the caller's own restaurant. */
export function previewUrl(slug: string): string {
  return `${STOREFRONT_ORIGIN}/r/${slug}/preview`;
}
