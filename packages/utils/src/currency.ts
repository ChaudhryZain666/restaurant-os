/**
 * Single formatting path for every money value shown anywhere in the product — before this, both
 * frontends hardcoded a literal "$" prefix and .toFixed(2) at ~35 call sites regardless of the
 * restaurant's actually-configured currency (Restaurant.settings.currency), which is wrong for any
 * non-USD restaurant and actively misleading for one (e.g. a PKR restaurant's totals rendered with
 * a "$" prefix). Intl.NumberFormat already knows the correct symbol, decimal count, and grouping
 * for any ISO-4217 code — no hardcoded currency-to-symbol/decimals table needed here.
 *
 * Falls back to a plain 2-decimal number (no symbol) for a missing/invalid currency code rather
 * than throwing — historical data or an unconfigured restaurant should never crash a screen over
 * a formatting choice.
 */
export function formatCurrency(amount: number, currencyCode: string | undefined | null): string {
  if (!currencyCode) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}
