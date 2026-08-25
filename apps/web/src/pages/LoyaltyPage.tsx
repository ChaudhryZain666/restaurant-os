import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LoyaltyAccount, LoyaltyReward, LoyaltyTransaction } from "@restaurant/types";
import { Alert, Button, Card, EmptyState, Skeleton } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useRestaurant } from "../context/RestaurantContext";
import { useNoIndex } from "../hooks/useNoIndex";

const TIER_LABELS: Record<string, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold" };

function StarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2.5l2.9 6.3 6.9.7-5.2 4.7 1.5 6.8-6.1-3.6-6.1 3.6 1.5-6.8-5.2-4.7 6.9-.7L12 2.5Z" />
    </svg>
  );
}

export function LoyaltyPage() {
  useNoIndex();
  const { restaurant } = useRestaurant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [account, setAccount] = useState<LoyaltyAccount | null>(null);
  const [history, setHistory] = useState<LoyaltyTransaction[]>([]);
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurant) return;
    setLoading(true);
    setError(null);
    Promise.all([
      apiClient.request<{ account: LoyaltyAccount }>(`/restaurants/${restaurant.id}/loyalty/me`),
      apiClient.request<{ transactions: LoyaltyTransaction[] }>(`/restaurants/${restaurant.id}/loyalty/me/history`),
      apiClient.request<{ rewards: LoyaltyReward[] }>(`/restaurants/${restaurant.id}/loyalty/rewards`),
    ])
      .then(([accountData, historyData, rewardsData]) => {
        setAccount(accountData.account);
        setHistory(historyData.transactions);
        setRewards(rewardsData.rewards);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [restaurant]);

  function redeemReward(reward: LoyaltyReward) {
    const cartHref = restaurant ? `/r/${restaurant.slug}/cart` : "/cart";
    navigate(cartHref, { state: { redeemRewardPoints: reward.pointCost } });
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl">
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="font-heading text-2xl font-semibold text-foreground">Loyalty</h1>

      <Card className="animate-scale-in flex items-center gap-4 bg-gradient-to-br from-primary to-accent text-primary-foreground">
        <StarGlyph className="h-10 w-10 shrink-0 opacity-90" />
        <div>
          <p className="text-2xl font-semibold">{account?.pointsBalance ?? 0} points</p>
          <p className="text-sm opacity-90">{TIER_LABELS[account?.tier ?? "bronze"]} tier</p>
        </div>
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="font-medium text-foreground">Rewards</h2>
        {rewards.length === 0 ? (
          <p className="text-sm text-muted">No rewards set up yet — you can still redeem points as a discount at checkout.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
            {rewards.map((r) => {
              const affordable = user !== null && (account?.pointsBalance ?? 0) >= r.pointCost;
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{r.name}</p>
                    {r.description && <p className="text-xs text-muted">{r.description}</p>}
                    <p className="text-xs text-muted">{r.pointCost} points</p>
                  </div>
                  <Button size="sm" variant={affordable ? "primary" : "outline"} disabled={!affordable} onClick={() => redeemReward(r)}>
                    Redeem
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-medium text-foreground">History</h2>
        {history.length === 0 ? (
          <EmptyState title="No activity yet" description="Points you earn or redeem will show up here." />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
            {history.map((tx) => (
              <li key={tx.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="text-foreground">{tx.reason}</span>
                <span className={`font-medium ${tx.points > 0 ? "text-success" : "text-danger"}`}>
                  {tx.points > 0 ? "+" : ""}
                  {tx.points}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
