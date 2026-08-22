import { Router } from "express";
import rateLimit from "express-rate-limit";
import { autocompleteQuerySchema, geocodeSchema, resolveSuggestionParamsSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { jsonRateLimitHandler } from "../middleware/rateLimitHandler.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { autocompleteAddress, geocodeAddress, resolveAddressSuggestion } from "../controllers/geocoding.controller.js";

export const geocodingRouter = Router();

// Address lookup isn't restaurant-scoped data — any authenticated user (customer or staff) can
// look up an address, same reasoning as promotion.routes.ts's /check being requireAuth-only.
geocodingRouter.use(requireAuth);

// Tighter than the app-wide limiter (app.ts): autocomplete is the one endpoint here a frontend
// could realistically call on every keystroke without a debounce bug, and each call costs a real
// provider request/quota. The frontend still debounces (Part 13) — this is the backstop.
const geocodingLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

geocodingRouter.get("/autocomplete", geocodingLimiter, validateQuery(autocompleteQuerySchema), asyncHandler(autocompleteAddress));
geocodingRouter.get(
  "/resolve/:suggestionId",
  geocodingLimiter,
  validateParams(resolveSuggestionParamsSchema),
  asyncHandler(resolveAddressSuggestion)
);
geocodingRouter.post("/geocode", geocodingLimiter, validateBody(geocodeSchema), asyncHandler(geocodeAddress));
