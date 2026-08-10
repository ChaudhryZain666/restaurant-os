import { useEffect, useState } from "react";
import type { LoyaltyAccount, LoyaltyTransaction } from "@restaurant/shared";
import { api } from "../lib/api";

export function LoyaltyPage() {
  const [account, setAccount] = useState<LoyaltyAccount | null>(null);
  const [history, setHistory] = useState<LoyaltyTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<{ account: LoyaltyAccount }>("/loyalty/me"),
      api<{ transactions: LoyaltyTransaction[] }>("/loyalty/me/history"),
    ])
      .then(([accountData, historyData]) => {
        setAccount(accountData.account);
        setHistory(historyData.transactions);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading loyalty account...</p>;

  return (
    <div>
      <h1>Loyalty</h1>
      <p>
        Balance: <strong>{account?.pointsBalance ?? 0} points</strong> — Tier: {account?.tier}
      </p>
      <h2>History</h2>
      <ul>
        {history.map((tx) => (
          <li key={tx.id}>
            {tx.type}: {tx.points > 0 ? "+" : ""}
            {tx.points} — {tx.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
