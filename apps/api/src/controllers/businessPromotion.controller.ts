import type { Request, Response } from "express";
import type { Types } from "mongoose";
import type { BusinessPromotionInput, UpdateBusinessPromotionInput } from "@restaurant/validation";
import { Promotion } from "../models/Promotion.js";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { recordAuditEvent } from "../services/audit.service.js";

/**
 * Phase 23 — business-wide promotions: one Promotion document, `locationIds` the owner-selected
 * subset of the business's own locations. Audit logging fans out one entry per targeted location
 * (rather than a single business-scoped entry) so each location's own admin can see it in their
 * own audit log — the same view GET /restaurants/:restaurantId/audit-log already provides, unchanged.
 */
async function assertLocationsBelongToBusiness(businessId: string, locationIds: string[]): Promise<void> {
  const validCount = await Restaurant.countDocuments({ businessId, _id: { $in: locationIds } });
  if (validCount !== locationIds.length) {
    throw ApiError.badRequest("One or more selected locations do not belong to this business");
  }
}

async function auditAcrossLocations(
  locationIds: string[],
  req: Request,
  action: "promotion.created" | "promotion.updated" | "promotion.activated" | "promotion.deactivated" | "promotion.deleted",
  promotionId: Types.ObjectId,
  code: string
) {
  await Promise.all(
    locationIds.map((restaurantId) =>
      recordAuditEvent({
        restaurantId,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action,
        targetType: "promotion",
        targetId: promotionId,
        metadata: { code, scope: "business" },
      })
    )
  );
}

export async function listBusinessPromotions(req: Request, res: Response) {
  const { businessId } = req.params;
  const promotions = await Promotion.find({ businessId }).sort({ createdAt: -1 });
  sendSuccess(res, { promotions: promotions.map((p) => p.toJSON()) });
}

export async function createBusinessPromotion(req: Request, res: Response) {
  const { businessId } = req.params;
  const body = req.body as BusinessPromotionInput;

  await assertLocationsBelongToBusiness(businessId, body.locationIds);

  const existing = await Promotion.findOne({ businessId, code: body.code });
  if (existing) throw ApiError.conflict("A promotion with this code already exists for this business");

  const promotion = await Promotion.create({ ...body, businessId });
  await auditAcrossLocations(body.locationIds, req, "promotion.created", promotion._id, promotion.code);

  sendSuccess(res, { promotion: promotion.toJSON() }, 201);
}

export async function updateBusinessPromotion(req: Request, res: Response) {
  const { businessId, id } = req.params;
  const updates = req.body as UpdateBusinessPromotionInput;

  if (updates.locationIds) {
    await assertLocationsBelongToBusiness(businessId, updates.locationIds);
  }
  if (updates.code) {
    const existing = await Promotion.findOne({ businessId, code: updates.code, _id: { $ne: id } });
    if (existing) throw ApiError.conflict("A promotion with this code already exists for this business");
  }

  const promotion = await Promotion.findOneAndUpdate(
    { _id: id, businessId },
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!promotion) throw ApiError.notFound("Promotion not found");

  const action =
    typeof updates.isActive === "boolean" ? (updates.isActive ? "promotion.activated" : "promotion.deactivated") : "promotion.updated";
  // Audited against the promotion's CURRENT (post-update) location set — if locations were also
  // changed in this same update, every currently-targeted location sees the event, matching what
  // GET /restaurants/:restaurantId/promotions will actually show from this point on.
  await auditAcrossLocations(promotion.locationIds?.map(String) ?? [], req, action, promotion._id, promotion.code);

  sendSuccess(res, { promotion: promotion.toJSON() });
}

export async function deleteBusinessPromotion(req: Request, res: Response) {
  const { businessId, id } = req.params;
  const promotion = await Promotion.findOneAndDelete({ _id: id, businessId });
  if (!promotion) throw ApiError.notFound("Promotion not found");

  await auditAcrossLocations(promotion.locationIds?.map(String) ?? [], req, "promotion.deleted", promotion._id, promotion.code);

  res.status(204).send();
}
