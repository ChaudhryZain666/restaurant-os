export declare const WEEKS_PER_MONTH: number;
export declare function commissionComparison(input: {
  weeklyOrders: number;
  averageOrder: number;
  commissionPercent: number;
  planMonthly: number;
}): { monthlyOrders: number; monthlyCommission: number; monthlyKeep: number; valid: boolean };
