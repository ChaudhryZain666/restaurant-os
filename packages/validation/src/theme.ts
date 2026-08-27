import { z } from "zod";
import { THEME_KEYS, THEME_RADIUS_SCALES, THEME_DENSITIES, THEME_SECTION_KEYS } from "@restaurant/types";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-digit hex color");

/**
 * Phase 31 — the entire persisted shape of a restaurant's theme choice. Every field is a closed
 * enum or a strictly-validated hex color; there is no `z.any()`/passthrough anywhere in this file,
 * so this can never accept or persist arbitrary CSS, JS, or an unbounded object (see
 * docs/theme-architecture.md's "Security model" section).
 */
export const restaurantThemeConfigSchema = z.object({
  themeKey: z.enum(THEME_KEYS),
  themeVersion: z.number().int().positive(),
  colors: z
    .object({
      primary: hexColor.optional(),
      secondary: hexColor.optional(),
      accent: hexColor.optional(),
      background: hexColor.optional(),
    })
    .strict(),
  radius: z.enum(THEME_RADIUS_SCALES).optional(),
  density: z.enum(THEME_DENSITIES).optional(),
  sections: z.record(z.enum(THEME_SECTION_KEYS), z.boolean()).default({}),
});
export type RestaurantThemeConfigInput = z.infer<typeof restaurantThemeConfigSchema>;

/** PATCH body for saving a draft — every field optional so the Theme Studio can save one change
 *  (e.g. just a color) without resending the whole config; the controller merges onto the
 *  existing draft (or the published config, the first time a draft is created). */
export const updateThemeDraftSchema = restaurantThemeConfigSchema.partial();
export type UpdateThemeDraftInput = z.infer<typeof updateThemeDraftSchema>;
