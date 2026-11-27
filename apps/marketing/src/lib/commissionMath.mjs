// Commission calculator maths (pricing page). Plain ESM so `node --test commissionMath.test.mjs`
// can check it without a build; CommissionCalculator.tsx imports it (types: commissionMath.d.mts).
//
// It compares what a marketplace's commission costs on a restaurant's own numbers with a flat
// GarnishTable plan. It never assumes a commission rate: the restaurant enters the rate from its own
// statement. It ignores card-processing fees on both sides (the restaurant pays those to its own
// payment provider either way; GarnishTable doesn't process online card payments yet).

/** Average weeks per month (52 / 12). */
export const WEEKS_PER_MONTH = 52 / 12;

/**
 * @param {{ weeklyOrders: number, averageOrder: number, commissionPercent: number, planMonthly: number }} input
 * @returns {{ monthlyOrders: number, monthlyCommission: number, monthlyKeep: number, valid: boolean }}
 */
export function commissionComparison({ weeklyOrders, averageOrder, commissionPercent, planMonthly }) {
  const valid =
    [weeklyOrders, averageOrder, commissionPercent, planMonthly].every((n) => Number.isFinite(n) && n >= 0) && commissionPercent <= 100;
  if (!valid) return { monthlyOrders: 0, monthlyCommission: 0, monthlyKeep: 0, valid: false };
  const monthlyOrders = weeklyOrders * WEEKS_PER_MONTH;
  const monthlyCommission = monthlyOrders * averageOrder * (commissionPercent / 100);
  return { monthlyOrders, monthlyCommission, monthlyKeep: monthlyCommission - planMonthly, valid: true };
}
