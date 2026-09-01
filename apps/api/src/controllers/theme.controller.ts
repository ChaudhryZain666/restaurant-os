import type { Request, Response } from "express";
import type { RestaurantThemeConfig } from "@restaurant/types";
import { normalizeThemeConfig } from "@restaurant/types";
import type { UpdateThemeDraftInput } from "@restaurant/validation";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { recordAuditEvent } from "../services/audit.service.js";

/**
 * Phase 31 — GET /restaurants/:restaurantId/theme: the Theme Studio's own load endpoint. Returns
 * both the published config and the current draft (if any) plus whether they differ, so the admin
 * UI can show "you have unpublished changes" without a second request or client-side diffing of
 * two separately-fetched restaurant objects.
 */
export async function getThemeConfig(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const restaurant = await Restaurant.findById(restaurantId).select("settings.theme themeDraft themePreviousPublished");
  if (!restaurant) throw ApiError.notFound("Restaurant not found");

  const published = normalizeThemeConfig(restaurant.settings.theme as Partial<RestaurantThemeConfig>);
  const draft = restaurant.themeDraft ? normalizeThemeConfig(restaurant.themeDraft as Partial<RestaurantThemeConfig>) : null;
  const previousPublished = restaurant.themePreviousPublished
    ? normalizeThemeConfig(restaurant.themePreviousPublished as Partial<RestaurantThemeConfig>)
    : null;
  sendSuccess(res, {
    published,
    draft,
    hasUnpublishedChanges: draft !== null && JSON.stringify(draft) !== JSON.stringify(published),
    // Phase 41 — lets the Theme Studio show/hide "Rollback to previous theme" without a second
    // request. Comparing against `published` (not just checking non-null) so the button correctly
    // disappears right after a rollback — at that point the two are identical, since rollbackTheme
    // swaps them.
    canRollback: previousPublished !== null && JSON.stringify(previousPublished) !== JSON.stringify(published),
  });
}

/**
 * PATCH /restaurants/:restaurantId/theme/draft — merges a partial update onto the current draft
 * (or the published config, the first time the Theme Studio is opened for this restaurant) and
 * saves it as the draft. Never touches `settings.theme` (the live, public config) — only
 * publishTheme below does that. Every field here already passed strict Zod validation
 * (updateThemeDraftSchema) before this runs — no unvalidated value ever reaches the database.
 */
export async function updateThemeDraft(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const input = req.body as UpdateThemeDraftInput;

  const restaurant = await Restaurant.findById(restaurantId).select("settings.theme themeDraft");
  if (!restaurant) throw ApiError.notFound("Restaurant not found");

  // .toObject() is required here — restaurant.themeDraft/settings.theme are live Mongoose
  // subdocuments, and spreading one directly (`{...subdoc}`) picks up Mongoose's own internal
  // bookkeeping (`$__`, `_doc`, ...) instead of the plain themeKey/colors/sections fields it looks
  // like it should have.
  const baselineDoc = (restaurant.themeDraft ?? restaurant.settings.theme) as unknown as { toObject(): Partial<RestaurantThemeConfig> };
  const baseline = normalizeThemeConfig(baselineDoc.toObject());
  // `colors`/`sections`, when present in the request at all, REPLACE the baseline's sub-object
  // wholesale rather than merging field-by-field. A field-level merge can never represent "clear
  // this override back to the theme default" — JSON.stringify drops `undefined` keys, so sending
  // `{colors: {}}` to clear every color would be indistinguishable from "no color change," and the
  // Theme Studio (apps/admin) always sends the complete current colors/sections object on every
  // save anyway (never a sparse single-field delta), so this is both the fix and the correct
  // contract for its actual usage. Omitting the key entirely (not sending `colors` at all) still
  // preserves the baseline, via the `??` fallback below.
  const merged: RestaurantThemeConfig = {
    ...baseline,
    ...input,
    colors: input.colors ?? baseline.colors,
    sections: input.sections ?? baseline.sections,
  };

  restaurant.themeDraft = merged;
  await restaurant.save();
  sendSuccess(res, { draft: merged });
}

/**
 * POST /restaurants/:restaurantId/theme/publish — copies the current draft onto the published
 * `settings.theme` and clears the draft. This is intentionally NOT gated by the restaurant's own
 * publish/setup readiness (a still-pending restaurant can freely pick and publish a theme while
 * finishing setup) — publishing a THEME and publishing the RESTAURANT are two independent
 * concepts; the restaurant's own `status` gate (unchanged, still fully enforced everywhere it
 * already was) is what actually controls whether the public storefront is reachable at all.
 */
export async function publishTheme(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const restaurant = await Restaurant.findById(restaurantId).select("settings.theme themeDraft");
  if (!restaurant) throw ApiError.notFound("Restaurant not found");

  if (!restaurant.themeDraft) {
    throw ApiError.badRequest("There are no unpublished theme changes to publish.");
  }

  const previouslyPublished = restaurant.settings.theme;
  const published = restaurant.themeDraft;
  restaurant.themePreviousPublished = previouslyPublished;
  restaurant.settings.theme = published;
  restaurant.themeDraft = undefined;
  await restaurant.save();

  await recordAuditEvent({
    restaurantId: restaurant._id,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "restaurant.theme_published",
    targetType: "restaurant",
    targetId: restaurant._id,
    metadata: { themeKey: (published as RestaurantThemeConfig).themeKey },
  });

  sendSuccess(res, { theme: normalizeThemeConfig(restaurant.settings.theme as Partial<RestaurantThemeConfig>) });
}

/**
 * POST /restaurants/:restaurantId/theme/rollback — Phase 41. Makes "publishing is reversible" a
 * real one-click action rather than "re-select the old theme and publish again": swaps
 * `settings.theme` back to whatever `themePreviousPublished` holds (the snapshot publishTheme took
 * immediately before its own last overwrite), then clears the snapshot. One level deep only —
 * rolling back does not itself create a further rollback target, matching "Theme B → Theme A" as a
 * single, deliberate action rather than open-ended undo/redo. Any in-progress DRAFT is left alone;
 * rollback only ever touches the published config, exactly like publish only ever touches it.
 */
export async function rollbackTheme(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const restaurant = await Restaurant.findById(restaurantId).select("settings.theme themePreviousPublished");
  if (!restaurant) throw ApiError.notFound("Restaurant not found");

  if (!restaurant.themePreviousPublished) {
    throw ApiError.badRequest("There is no previous published theme to roll back to.");
  }

  const rolledBackTo = restaurant.themePreviousPublished;
  restaurant.settings.theme = rolledBackTo;
  restaurant.themePreviousPublished = undefined;
  await restaurant.save();

  await recordAuditEvent({
    restaurantId: restaurant._id,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "restaurant.theme_rolled_back",
    targetType: "restaurant",
    targetId: restaurant._id,
    metadata: { themeKey: (rolledBackTo as RestaurantThemeConfig).themeKey },
  });

  sendSuccess(res, { theme: normalizeThemeConfig(restaurant.settings.theme as Partial<RestaurantThemeConfig>) });
}

/**
 * POST /restaurants/:restaurantId/theme/discard-draft — throws away unpublished edits, reverting
 * the Theme Studio back to the currently-published config. A small but real safety valve: without
 * it, an owner who's made changes they don't like has no way back to "what's actually live" short
 * of manually re-entering every value.
 */
export async function discardThemeDraft(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const restaurant = await Restaurant.findById(restaurantId).select("themeDraft");
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  restaurant.themeDraft = undefined;
  await restaurant.save();
  sendSuccess(res, { message: "Draft discarded." });
}
