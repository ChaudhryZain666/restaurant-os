import type { Request, Response } from "express";
import type { ListAuditLogQueryInput } from "@restaurant/validation";
import type { AuditLogEntry } from "@restaurant/types";
import { AuditLog } from "../models/AuditLog.js";
import { User } from "../models/User.js";
import { sendSuccess } from "../common/response.js";
import { paginateQuery } from "../utils/pagination.js";

/** GET /restaurants/:restaurantId/audit-log — paginated, optionally scoped to one target via
 *  ?targetType=&targetId=, one action via ?action=, one actor via ?actorUserId=, and/or a
 *  ?startDate=&endDate= (YYYY-MM-DD, inclusive on both ends) range. */
export async function listAuditLog(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const { page, limit, targetType, targetId, action, actorUserId, startDate, endDate } =
    req.query as unknown as ListAuditLogQueryInput;

  const filter: Record<string, unknown> = { restaurantId };
  if (targetType) filter.targetType = targetType;
  if (targetId) filter.targetId = targetId;
  if (action) filter.action = action;
  if (actorUserId) filter.actorUserId = actorUserId;
  if (startDate || endDate) {
    const createdAt: Record<string, Date> = {};
    if (startDate) createdAt.$gte = new Date(`${startDate}T00:00:00.000Z`);
    if (endDate) createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    filter.createdAt = createdAt;
  }

  const result = await paginateQuery(AuditLog.find(filter).sort({ createdAt: -1 }), { page, limit });

  // Actor names aren't stored on the log entry itself (the actor's OWN name/role can legitimately
  // change after the fact — the log should reflect who they were at the time via actorRole,
  // already stored, plus a best-effort CURRENT name for readability) — resolved here, bounded to
  // just this page's distinct actors, never the whole audit history.
  const actorIds = [...new Set(result.items.map((e) => e.actorUserId.toString()))];
  const actors = await User.find({ _id: { $in: actorIds } }).select("name");
  const actorNameById = new Map(actors.map((a) => [a.id as string, a.name]));

  const items: AuditLogEntry[] = result.items.map((e) => ({
    ...(e.toJSON() as unknown as Omit<AuditLogEntry, "actorName">),
    actorName: actorNameById.get(e.actorUserId.toString()),
  }));

  sendSuccess(res, { ...result, items });
}
