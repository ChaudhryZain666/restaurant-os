import mongoose from "mongoose";

// Side-effect imports only — each registers its model(s) with Mongoose on load. Every model file in
// src/models must be listed here, or its indexes silently never get ensured/checked.
import "../models/User.js";
import "../models/Restaurant.js";
import "../models/Business.js";
import "../models/Agency.js";
import "../models/AgencyMembership.js";
import "../models/AgencyAuditLog.js";
import "../models/Order.js";
import "../models/Payment.js";
import "../models/Refund.js";
import "../models/PaymentWebhookEvent.js";
import "../models/BillingWebhookEvent.js";
import "../models/BillingHistoryEvent.js";
import "../models/Subscription.js";
import "../models/Plan.js";
import "../models/RestaurantPaymentAccount.js";
import "../models/RestaurantDeliveryProviderAccount.js";
import "../models/Delivery.js";
import "../models/DeliveryWebhookEvent.js";
import "../models/Category.js";
import "../models/MenuItem.js";
import "../models/ModifierGroup.js";
import "../models/CategoryLocationOverride.js";
import "../models/MenuItemLocationOverride.js";
import "../models/ModifierGroupLocationOverride.js";
import "../models/Table.js";
import "../models/AuditLog.js";
import "../models/DomainMapping.js";
import "../models/MockDnsRecord.js";
import "../models/Promotion.js";
import "../models/LoyaltyAccount.js";
import "../models/LoyaltyReward.js";
import "../models/SupportTicket.js";
import "../models/KnowledgeBase.js";
import "../models/Counter.js";

import { User } from "../models/User.js";
import { Restaurant } from "../models/Restaurant.js";
import { Business } from "../models/Business.js";
import { Agency } from "../models/Agency.js";
import { Order } from "../models/Order.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
import { DomainMapping } from "../models/DomainMapping.js";
import { Table } from "../models/Table.js";
import { SupportTicket } from "../models/SupportTicket.js";
import { LoyaltyAccount } from "../models/LoyaltyAccount.js";
import { Plan } from "../models/Plan.js";

/**
 * Phase 49 — the deliberate, deploy-time-invoked counterpart to Mongoose's own autoIndex, which
 * config/db.ts now disables in production (see that file's comment). Intended to run once as part
 * of deploying any change that adds or modifies a schema index — never automatically on server
 * startup. Purely ADDITIVE via `createIndexes()`: builds whatever indexes the current schema
 * defines that don't already exist, never drops or rebuilds one. See
 * docs/database-indexes-and-migrations.md for the full process, and scripts/ensureIndexes.ts for
 * the thin CLI entry point that calls this.
 */
export interface RetiredIndexResult {
  collection: string;
  indexName: string;
  supersededBy: string;
  dropped: boolean;
  reason: "dropped" | "already-gone" | "replacement-missing";
}

const RETIRED_INDEXES: Array<{ collection: string; indexName: string; supersededBy: string }> = [
  { collection: "loyaltytransactions", indexName: "restaurantId_1", supersededBy: "restaurantId_1_customerId_1_createdAt_-1" },
  { collection: "loyaltytransactions", indexName: "customerId_1", supersededBy: "restaurantId_1_customerId_1_createdAt_-1" },
  { collection: "payments", indexName: "status_1", supersededBy: "status_1_createdAt_1" },
];

export async function ensureAllIndexes(): Promise<{ modelsProcessed: string[]; retired: RetiredIndexResult[] }> {
  const modelNames = mongoose.modelNames();
  for (const name of modelNames) {
    await mongoose.model(name).createIndexes();
  }

  const retired: RetiredIndexResult[] = [];
  for (const { collection, indexName, supersededBy } of RETIRED_INDEXES) {
    const coll = mongoose.connection.db!.collection(collection);
    const existing = await coll.indexes();
    const replacementExists = existing.some((i) => i.name === supersededBy);
    const oldExists = existing.some((i) => i.name === indexName);
    if (!oldExists) {
      retired.push({ collection, indexName, supersededBy, dropped: false, reason: "already-gone" });
      continue;
    }
    if (!replacementExists) {
      retired.push({ collection, indexName, supersededBy, dropped: false, reason: "replacement-missing" });
      continue;
    }
    await coll.dropIndex(indexName);
    retired.push({ collection, indexName, supersededBy, dropped: true, reason: "dropped" });
  }

  return { modelsProcessed: modelNames, retired };
}

/**
 * Phase 49 — read-only diagnostic, never writes/deletes anything. Every field checked here already
 * has a DB-level unique index — this verifies that enforcement actually holds against real data,
 * rather than enforcing it itself. Reports findings; never chooses a "winner" or deletes anything.
 * See scripts/checkDuplicateRisk.ts for the thin CLI entry point that calls this.
 */
export interface DuplicateCheckResult {
  label: string;
  violations: Array<{ key: unknown; count: number }>;
}

// Model<any>, deliberately: this operates uniformly across many structurally-unrelated models
// (User, Restaurant, Table, Order, ...) via only shape-erased operations (aggregate()) — there is
// no useful document type to parameterize this with, and a generic <T> here previously produced
// real TS2345 errors for models whose Doc type is an intersection (e.g. Order/Table's
// `InferSchemaType<...> & {_id: Types.ObjectId}`) once several calls sat inside one array literal.
function groupCheck(
  label: string,
  model: mongoose.Model<any>,
  groupBy: Record<string, unknown>,
  extraMatch: Record<string, unknown> = {}
): { label: string; run: () => Promise<DuplicateCheckResult> } {
  return {
    label,
    run: async () => {
      const rows = await model.aggregate([
        { $match: extraMatch },
        { $group: { _id: groupBy, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ]);
      return { label, violations: rows.map((r) => ({ key: r._id, count: r.count as number })) };
    },
  };
}

export async function findDuplicates(): Promise<DuplicateCheckResult[]> {
  const checks = [
    groupCheck("User.email (global unique)", User, { email: "$email" }),
    groupCheck("Restaurant.slug (global unique)", Restaurant, { slug: "$slug" }),
    groupCheck("Business.slug (global unique)", Business, { slug: "$slug" }),
    groupCheck("Agency.slug (global unique)", Agency, { slug: "$slug" }),
    groupCheck("Plan.code (global unique)", Plan, { code: "$code" }),
    groupCheck("DomainMapping.hostname (global unique)", DomainMapping, { hostname: "$hostname" }),
    groupCheck("Table.qrToken (global unique)", Table, { qrToken: "$qrToken" }),
    groupCheck("SupportTicket.ticketNumber (global unique)", SupportTicket, { ticketNumber: "$ticketNumber" }),
    groupCheck("Order.{restaurantId,orderNumber} (compound unique)", Order, {
      restaurantId: "$restaurantId",
      orderNumber: "$orderNumber",
    }),
    groupCheck("AgencyMembership.{agencyId,userId} (compound unique)", AgencyMembership, {
      agencyId: "$agencyId",
      userId: "$userId",
    }),
    groupCheck("LoyaltyAccount.{restaurantId,customerId} (compound unique)", LoyaltyAccount, {
      restaurantId: "$restaurantId",
      customerId: "$customerId",
    }),
  ];

  return Promise.all(checks.map((c) => c.run()));
}
