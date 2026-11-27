import { test } from "node:test";
import assert from "node:assert/strict";
import { commissionComparison, WEEKS_PER_MONTH } from "./src/lib/commissionMath.mjs";

test("monthly commission is weekly orders × 52/12 × average order × the restaurant's own rate", () => {
  const r = commissionComparison({ weeklyOrders: 30, averageOrder: 20, commissionPercent: 25, planMonthly: 59 });
  assert.equal(r.valid, true);
  assert.equal(Math.round(r.monthlyOrders * 100) / 100, Math.round(30 * WEEKS_PER_MONTH * 100) / 100);
  assert.equal(Math.round(r.monthlyCommission), 650); // 130 orders × $20 × 25%
  assert.equal(Math.round(r.monthlyKeep), 591); // minus the $59 plan
});

test("a plan can cost more than the commission it replaces, and the result says so (negative keep)", () => {
  const r = commissionComparison({ weeklyOrders: 2, averageOrder: 15, commissionPercent: 15, planMonthly: 99 });
  assert.ok(r.monthlyKeep < 0);
});

test("rejects impossible input instead of showing a number", () => {
  for (const bad of [
    { weeklyOrders: -1, averageOrder: 20, commissionPercent: 20, planMonthly: 59 },
    { weeklyOrders: 10, averageOrder: Number.NaN, commissionPercent: 20, planMonthly: 59 },
    { weeklyOrders: 10, averageOrder: 20, commissionPercent: 120, planMonthly: 59 },
  ]) {
    assert.equal(commissionComparison(bad).valid, false);
  }
});
