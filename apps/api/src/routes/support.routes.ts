import { Router } from "express";
import { createTicketMessageSchema, createTicketSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  confirmResolution,
  createTicket,
  createTicketMessage,
  getTicket,
  getTicketMessages,
  listMyTickets,
} from "../controllers/support.controller.js";

/** Customer/self-service ticket routes — identity-scoped, mounted at top-level /support. */
export const supportRouter = Router();

supportRouter.use(requireAuth);
supportRouter.post("/tickets", validateBody(createTicketSchema), asyncHandler(createTicket));
supportRouter.get("/tickets/mine", asyncHandler(listMyTickets));
supportRouter.get("/tickets/:id", asyncHandler(getTicket));
supportRouter.get("/tickets/:id/messages", asyncHandler(getTicketMessages));
supportRouter.post("/tickets/:id/messages", validateBody(createTicketMessageSchema), asyncHandler(createTicketMessage));
supportRouter.patch("/tickets/:id/confirm-resolution", asyncHandler(confirmResolution));
