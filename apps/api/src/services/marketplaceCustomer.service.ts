import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { MarketplaceProviderName } from "@restaurant/types";
import { User } from "../models/User.js";

/**
 * Resolves a marketplace order's `customerId` — direct structural mirror of
 * posCustomer.service.ts's resolvePosCustomerId (see that file's doc comment for the full
 * reasoning). A marketplace webhook never carries a GarnishTable account, only whatever the
 * marketplace itself has on file for the diner (name/phone, often incomplete) — this always
 * creates a fresh, real (not isDemoAccount) customer per order rather than attempting fuzzy
 * matching across orders, since a marketplace's own customer identifier is never exposed to this
 * platform to match against reliably. `createOrderForCustomer`'s unconditional loyalty accrual
 * therefore runs harmlessly on an account nobody will ever log into — the same acknowledged, not
 * fixed, behavior POS walk-ins already have.
 */
export async function resolveMarketplaceCustomerId(provider: MarketplaceProviderName, name: string | undefined, phone: string | undefined): Promise<string> {
  const resolvedEmail = `marketplace-${provider}-${randomBytes(8).toString("hex")}@marketplace.local`;
  const passwordHash = await bcrypt.hash(randomBytes(16).toString("hex"), 12);
  try {
    const user = await User.create({
      name: name || "Marketplace customer",
      email: resolvedEmail,
      phone,
      passwordHash,
      role: "customer",
    });
    return user.id;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      // Negligible-odds synthetic-email collision — same backstop posCustomer.service.ts's own
      // synthetic path relies on.
      const existing = await User.findOne({ email: resolvedEmail, role: "customer" });
      if (existing) return existing.id;
    }
    throw err;
  }
}
