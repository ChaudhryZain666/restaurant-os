import type { Request, Response } from "express";
import { DomainMapping } from "../models/DomainMapping.js";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { recordAuditEvent } from "../services/audit.service.js";
import {
  generateVerificationToken,
  verificationRecordHost,
  checkDomainVerification,
  isSelfClaim,
} from "../services/domainVerification.service.js";
import { env } from "../config/env.js";

/**
 * Phase 22 — owner-facing domain management. `getRestaurantByDomain` (the public storefront-
 * resolution counterpart) lives in restaurant.controller.ts alongside getRestaurantBySlug, since it
 * shares that file's private toPublicRestaurant()/availability/supportIdentity helpers — this file
 * is only the authenticated CRUD/lifecycle surface.
 */

function toDomainMappingDto(mapping: InstanceType<typeof DomainMapping>) {
  return { ...mapping.toJSON(), verificationRecordHost: verificationRecordHost(mapping.hostname) };
}

export async function listDomainsForBusiness(req: Request, res: Response) {
  const domains = await DomainMapping.find({ businessId: req.params.businessId }).sort({ createdAt: -1 });
  sendSuccess(res, { domains: domains.map(toDomainMappingDto) });
}

export async function addDomain(req: Request, res: Response) {
  const { hostname } = req.body as { hostname: string };
  const restaurantId = req.params.restaurantId;

  if (isSelfClaim(hostname, new URL(env.CLIENT_ORIGIN).hostname)) {
    throw ApiError.badRequest("This platform's own domain can't be claimed as a custom domain");
  }

  const restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  if (!restaurant.businessId) {
    throw ApiError.badRequest("This restaurant has no business association yet");
  }

  const existing = await DomainMapping.findOne({ hostname });
  if (existing) throw ApiError.conflict("This domain is already claimed on this platform");

  let mapping;
  try {
    mapping = await DomainMapping.create({
      hostname,
      businessId: restaurant.businessId,
      locationId: restaurant._id,
      status: "pending_verification",
      verificationToken: generateVerificationToken(),
    });
  } catch (err) {
    // Same pre-check + unique-index-backstop pattern as Restaurant.slug/Business.slug — the
    // pre-check above narrows the common case, but two concurrent requests for the same hostname
    // can both pass it before either insert commits; the unique index on `hostname` is the real
    // backstop.
    if ((err as { code?: number }).code === 11000) {
      throw ApiError.conflict("This domain is already claimed on this platform");
    }
    throw err;
  }

  await recordAuditEvent({
    restaurantId: restaurant._id,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "domain.added",
    targetType: "domain",
    targetId: mapping._id,
    metadata: { hostname },
  });

  sendSuccess(res, { domain: toDomainMappingDto(mapping) }, 201);
}

async function findOwnedMapping(restaurantId: string, mappingId: string) {
  const mapping = await DomainMapping.findOne({ _id: mappingId, locationId: restaurantId });
  if (!mapping) throw ApiError.notFound("Domain not found");
  return mapping;
}

export async function checkDomainVerificationStatus(req: Request, res: Response) {
  const mapping = await findOwnedMapping(req.params.restaurantId, req.params.id);

  const verified = await checkDomainVerification(mapping.hostname, mapping.verificationToken);
  mapping.verificationCheckedAt = new Date();
  if (verified && mapping.status === "pending_verification") {
    mapping.status = "verified";
    mapping.verifiedAt = new Date();
    await mapping.save();
    await recordAuditEvent({
      restaurantId: mapping.locationId,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: "domain.verified",
      targetType: "domain",
      targetId: mapping._id,
      metadata: { hostname: mapping.hostname },
    });
  } else {
    await mapping.save();
  }

  sendSuccess(res, { verified, domain: toDomainMappingDto(mapping) });
}

export async function activateDomain(req: Request, res: Response) {
  const mapping = await findOwnedMapping(req.params.restaurantId, req.params.id);
  if (mapping.status === "pending_verification") {
    throw ApiError.badRequest("This domain must pass verification before it can be activated");
  }
  if (mapping.status === "active") {
    sendSuccess(res, { domain: toDomainMappingDto(mapping) });
    return;
  }

  mapping.status = "active";
  mapping.activatedAt = new Date();
  try {
    await mapping.save();
  } catch (err) {
    // The partial-unique index on {locationId} where status:"active" is the real backstop against
    // a race between two activate requests (or activate-vs-a-still-active sibling domain) — this
    // location already has a different active domain; deactivate/remove it first.
    if ((err as { code?: number }).code === 11000) {
      throw ApiError.conflict("This location already has an active domain — deactivate or remove it first");
    }
    throw err;
  }

  await recordAuditEvent({
    restaurantId: mapping.locationId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "domain.activated",
    targetType: "domain",
    targetId: mapping._id,
    metadata: { hostname: mapping.hostname },
  });

  sendSuccess(res, { domain: toDomainMappingDto(mapping) });
}

export async function deactivateDomain(req: Request, res: Response) {
  const mapping = await findOwnedMapping(req.params.restaurantId, req.params.id);
  if (mapping.status !== "active") {
    sendSuccess(res, { domain: toDomainMappingDto(mapping) });
    return;
  }

  mapping.status = "verified";
  await mapping.save();

  await recordAuditEvent({
    restaurantId: mapping.locationId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "domain.deactivated",
    targetType: "domain",
    targetId: mapping._id,
    metadata: { hostname: mapping.hostname },
  });

  sendSuccess(res, { domain: toDomainMappingDto(mapping) });
}

export async function removeDomain(req: Request, res: Response) {
  const mapping = await findOwnedMapping(req.params.restaurantId, req.params.id);
  await mapping.deleteOne();

  await recordAuditEvent({
    restaurantId: mapping.locationId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "domain.removed",
    targetType: "domain",
    targetId: mapping._id,
    metadata: { hostname: mapping.hostname },
  });

  sendSuccess(res, { removed: true });
}
