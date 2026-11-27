import { useId, useState } from "react";
import { commissionComparison } from "../lib/commissionMath.mjs";

/**
 * "What do delivery-app commissions cost you?" on the pricing page. The restaurant enters its own
 * numbers, including its marketplace's commission rate from its own statement; the starting values
 * are an example, labelled as one. Compares that with a flat GarnishTable plan (0% commission on
 * direct orders). Honest limits are stated beside the result: it assumes those orders come to the
 * restaurant directly instead, and card-processing fees aren't included (GarnishTable doesn't take
 * online card payments yet).
 */
const PLANS = [
  { label: "Starter", monthly: 59 },
  { label: "Growth", monthly: 99 },
] as const;

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function NumberField({ label, hint, value, onChange, min, max, step, suffix }: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max?: number;
  step: number;
  suffix?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
        />
        {suffix && <span className="text-muted">{suffix}</span>}
      </span>
      <span className="text-xs text-muted">{hint}</span>
    </label>
  );
}

export function CommissionCalculator() {
  const [weeklyOrders, setWeeklyOrders] = useState("30");
  const [averageOrder, setAverageOrder] = useState("20");
  const [commission, setCommission] = useState("25");
  const [plan, setPlan] = useState<(typeof PLANS)[number]>(PLANS[0]);

  const result = commissionComparison({
    weeklyOrders: Number(weeklyOrders),
    averageOrder: Number(averageOrder),
    commissionPercent: Number(commission),
    planMonthly: plan.monthly,
  });

  return (
    <div id="commission-calculator" className="mx-auto grid max-w-4xl gap-8 rounded-2xl border border-border bg-surface p-6 md:grid-cols-2 md:p-8">
      <div className="flex flex-col gap-4">
        <h2 className="font-heading text-2xl font-semibold text-foreground">What do delivery-app commissions cost you?</h2>
        <p className="text-sm text-muted">
          Enter your own numbers. The starting values are only an example; use your marketplace statement for the commission rate.
        </p>
        <NumberField label="Marketplace orders per week" hint="Orders through Uber Eats, DoorDash, Just Eat, Deliveroo or similar." value={weeklyOrders} onChange={setWeeklyOrders} min={0} step={1} />
        <NumberField label="Average order value" hint="In your currency; GarnishTable's prices below are in US dollars." value={averageOrder} onChange={setAverageOrder} min={0} step={0.5} />
        <NumberField label="Commission rate" hint="The percentage the marketplace keeps per order." value={commission} onChange={setCommission} min={0} max={100} step={0.5} suffix="%" />
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-medium text-foreground">Compare with</legend>
          <div className="flex gap-2">
            {PLANS.map((p) => (
              <button
                key={p.label}
                type="button"
                aria-pressed={plan.label === p.label}
                onClick={() => setPlan(p)}
                className={`rounded-full px-4 py-1.5 font-medium ${plan.label === p.label ? "bg-primary text-primary-foreground" : "border border-border text-foreground"}`}
              >
                {p.label} · ${p.monthly}/month
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="flex flex-col justify-center gap-4" aria-live="polite">
        {result.valid ? (
          <>
            <div>
              <p className="text-sm text-muted">Commission on about {Math.round(result.monthlyOrders)} orders a month</p>
              <p className="font-heading text-4xl font-semibold text-foreground">{money(result.monthlyCommission)}</p>
            </div>
            <div>
              <p className="text-sm text-muted">GarnishTable {plan.label}, 0% commission on direct orders</p>
              <p className="font-heading text-2xl font-semibold text-foreground">${plan.monthly}/month</p>
            </div>
            <p className="rounded-lg bg-background p-4 text-sm text-foreground">
              {result.monthlyKeep > 0
                ? `If these orders came to you directly instead, you'd keep about ${money(result.monthlyKeep)} more a month.`
                : "At these numbers, the commission you'd save is less than the plan costs. Direct ordering may still be worth it for the customer relationship, but the savings alone don't cover it yet."}
            </p>
            <p className="text-xs text-muted">
              Assumes these orders move to your own ordering page. Card-processing fees aren't included: you pay those to your own payment
              provider, and GarnishTable doesn't take online card payments yet (customers pay you at pickup, on delivery or at the table).
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">Enter numbers of zero or more, and a commission rate between 0 and 100%.</p>
        )}
      </div>
    </div>
  );
}
