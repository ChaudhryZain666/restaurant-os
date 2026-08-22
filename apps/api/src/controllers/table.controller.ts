import type { Request, Response } from "express";
import { Types } from "mongoose";
import type { CreateTableInput, UpdateTableInput } from "@restaurant/validation";
import { Table } from "../models/Table.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { generateTableToken } from "../services/tableToken.service.js";
import { generateQrDataUrl } from "../services/qr.service.js";
import { env } from "../config/env.js";

const ACTIVE_ORDER_STATUSES = ["pending", "confirmed", "preparing", "ready", "out_for_delivery"];

/**
 * Table status is derived from live orders, never stored — see
 * docs/qr-dine-in-architecture.md's "table status" section for why. One aggregation covers every
 * table in the restaurant rather than an N+1 query per table.
 */
async function getActiveOrdersByTable(restaurantId: string): Promise<Map<string, string[]>> {
  const rows = await Order.aggregate<{ _id: Types.ObjectId; orderNumbers: string[] }>([
    {
      $match: {
        restaurantId: new Types.ObjectId(restaurantId),
        orderType: "dine_in",
        tableId: { $ne: null },
        status: { $in: ACTIVE_ORDER_STATUSES },
      },
    },
    { $group: { _id: "$tableId", orderNumbers: { $push: "$orderNumber" } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.orderNumbers]));
}

function tableUrl(restaurantSlug: string, qrToken: string): string {
  // Phase 8: the storefront is now genuinely multi-tenant (see
  // docs/multi-tenant-storefront-architecture.md), so the QR URL is restaurant-scoped —
  // /r/:restaurantSlug/t/:qrToken. The slug is public information (it's already in the storefront
  // URL a customer is browsing); qrToken remains the opaque, secure table identifier.
  return `${env.CLIENT_ORIGIN}/r/${restaurantSlug}/t/${qrToken}`;
}

export async function listTables(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const [tables, activeByTable] = await Promise.all([
    Table.find({ restaurantId }).sort({ name: 1 }),
    getActiveOrdersByTable(restaurantId),
  ]);

  const withStatus = tables.map((t) => {
    const activeOrderNumbers = activeByTable.get(t.id) ?? [];
    return {
      ...t.toJSON(),
      status: activeOrderNumbers.length > 0 ? "occupied" : "available",
      activeOrderCount: activeOrderNumbers.length,
      activeOrderNumbers,
    };
  });

  sendSuccess(res, { tables: withStatus });
}

export async function createTable(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const { name, capacity, section } = req.body as CreateTableInput;

  const table = await Table.create({
    restaurantId,
    name,
    capacity,
    section,
    qrToken: generateTableToken(),
  });

  sendSuccess(res, { table: table.toJSON() }, 201);
}

export async function updateTable(req: Request, res: Response) {
  const { restaurantId, tableId } = req.params;
  const updates = req.body as UpdateTableInput;

  const table = await Table.findOneAndUpdate({ _id: tableId, restaurantId }, { $set: updates }, { new: true, runValidators: true });
  if (!table) throw ApiError.notFound("Table not found");
  sendSuccess(res, { table: table.toJSON() });
}

/**
 * Deletion is allowed but guarded, not the default path — Part 23's "prefer deactivate" is
 * satisfied by updateTable's isActive toggle; this exists for genuine mistakes (wrong table
 * created) rather than end-of-service teardown. Historical orders are safe either way because
 * Order.tableName is a snapshot, not a live join (see models/Order.ts) — but an ACTIVE dine-in
 * order still in progress at this table would go silently orphaned (tableId pointing nowhere),
 * so that specific case is blocked.
 */
export async function deleteTable(req: Request, res: Response) {
  const { restaurantId, tableId } = req.params;

  const activeCount = await Order.countDocuments({
    restaurantId,
    tableId,
    status: { $in: ACTIVE_ORDER_STATUSES },
  });
  if (activeCount > 0) {
    throw ApiError.conflict("This table has an active order — deactivate it instead, or wait until the order is complete");
  }

  const result = await Table.deleteOne({ _id: tableId, restaurantId });
  if (result.deletedCount === 0) throw ApiError.notFound("Table not found");
  res.status(204).send();
}

export async function getTableQr(req: Request, res: Response) {
  const { restaurantId, tableId } = req.params;
  const [table, restaurant] = await Promise.all([
    Table.findOne({ _id: tableId, restaurantId }),
    Restaurant.findById(restaurantId),
  ]);
  if (!table || !restaurant) throw ApiError.notFound("Table not found");

  const url = tableUrl(restaurant.slug, table.qrToken);
  const qrDataUrl = await generateQrDataUrl(url);
  sendSuccess(res, { qrDataUrl, url });
}

/** Rotates the table's public token — the previously-printed/scanned QR stops resolving
 *  immediately (see resolveTable: it's an exact-match lookup, so the old token simply no longer
 *  matches anything). Everything else about the table (name, capacity, orders) is untouched. */
export async function regenerateTableQr(req: Request, res: Response) {
  const { restaurantId, tableId } = req.params;
  const table = await Table.findOneAndUpdate(
    { _id: tableId, restaurantId },
    { $set: { qrToken: generateTableToken() } },
    { new: true }
  );
  if (!table) throw ApiError.notFound("Table not found");

  const restaurant = await Restaurant.findById(restaurantId);
  const url = tableUrl(restaurant!.slug, table.qrToken);
  const qrDataUrl = await generateQrDataUrl(url);
  sendSuccess(res, { table: table.toJSON(), qrDataUrl, url });
}

/**
 * Public — no auth. A customer scanning a QR isn't logged in yet (same reasoning as
 * GET /restaurants/by-slug/:slug). Returns only what a customer needs to see; never the
 * qrToken itself, never restaurantId, never any other table's data.
 */
export async function resolveTable(req: Request, res: Response) {
  const { restaurantId, token } = req.params;
  const table = await Table.findOne({ restaurantId, qrToken: token, isActive: true });
  if (!table) throw ApiError.notFound("This table code is no longer valid");

  sendSuccess(res, {
    table: { id: table.id, name: table.name, capacity: table.capacity, section: table.section },
  });
}
