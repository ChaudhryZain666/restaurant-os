import type { Request, Response } from "express";
import type { HydratedDocument } from "mongoose";
import type {
  AssignTicketInput,
  CreateTicketInput,
  CreateTicketMessageInput,
  UpdateTicketPriorityInput,
  UpdateTicketStatusInput,
} from "@restaurant/validation";
import { roleHasPermission, type UserRole } from "@restaurant/types";
import { Restaurant } from "../models/Restaurant.js";
import { SupportMessage, SupportTicket, type SupportTicketDoc } from "../models/SupportTicket.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { nextTicketNumber } from "../services/ticketNumber.service.js";
import { isValidTicketTransition } from "../services/ticketStateMachine.js";
import { emitTicketEvent } from "../events/ticketEvents.js";
import { resolveTenantAccess } from "../middleware/tenant.js";

type AuthedUser = { id: string; role: UserRole; restaurantId?: string };
type TicketDoc = HydratedDocument<SupportTicketDoc>;

/** Platform support staff, for support-ticket purposes, are whoever holds support.tickets.write — today that's only platform_admin. */
function isSupportStaff(role: UserRole): boolean {
  return roleHasPermission(role, "support.tickets.write");
}

function authorTypeFor(role: UserRole): "customer" | "support" {
  return isSupportStaff(role) ? "support" : "customer";
}

interface TicketAccess {
  isOwner: boolean;
  isStaff: boolean;
  canSeeInternal: boolean;
}

/**
 * The single access-check helper every ticket-reading/writing handler goes through — mirrors
 * order.controller.ts's isOwner/isStaffForThisRestaurant pattern. A restaurant_owner/manager
 * only gets `isStaff` for tickets that belong to THEIR OWN restaurant; platform_admin gets it
 * for every ticket. Internal notes are gated entirely separately (support.tickets.internal_notes),
 * which today only platform_admin holds — a restaurant owner viewing their own restaurant's
 * ticket is `isStaff` but never `canSeeInternal`.
 *
 * Phase 35 audit fix — was a flat `user.restaurantId === ticket.restaurantId` comparison, the same
 * bug class already fixed once in order.controller.ts's getOrder (Phase 29 finding P1-8) and this
 * session in payment.controller.ts's assertCanViewOrderPayments: over-restrictive, not a security
 * hole, but a false 403 for any multi-location owner/manager/agency member viewing a support
 * ticket for a location other than the one their JWT was originally issued for. Now async so it can
 * go through the same resolveTenantAccess every other multi-location-aware route already uses.
 */
async function getTicketAccess(ticket: TicketDoc, user: AuthedUser): Promise<TicketAccess> {
  const isOwner = ticket.createdBy.toString() === user.id;
  const isPlatformStaff = user.role === "platform_admin" && roleHasPermission(user.role, "support.tickets.read");
  const isRestaurantStaff =
    ticket.restaurantId != null &&
    roleHasPermission(user.role, "support.tickets.read") &&
    (await resolveTenantAccess(user, ticket.restaurantId.toString())).allowed;
  const canSeeInternal = roleHasPermission(user.role, "support.tickets.internal_notes");
  return { isOwner, isStaff: isPlatformStaff || isRestaurantStaff, canSeeInternal };
}

async function enrichTickets(tickets: TicketDoc[]) {
  const userIds = [...new Set(tickets.flatMap((t) => [t.createdBy.toString(), t.assignedTo?.toString()].filter(Boolean)))];
  const restaurantIds = [...new Set(tickets.map((t) => t.restaurantId?.toString()).filter(Boolean))];
  const [users, restaurants] = await Promise.all([
    User.find({ _id: { $in: userIds } }, "name email"),
    Restaurant.find({ _id: { $in: restaurantIds } }, "name"),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const restaurantById = new Map(restaurants.map((r) => [r.id, r]));

  return tickets.map((t) => {
    const creator = userById.get(t.createdBy.toString());
    const assignee = t.assignedTo ? userById.get(t.assignedTo.toString()) : undefined;
    const restaurant = t.restaurantId ? restaurantById.get(t.restaurantId.toString()) : undefined;
    return {
      ...t.toJSON(),
      createdByName: creator?.name,
      createdByEmail: creator?.email,
      assignedToName: assignee?.name,
      restaurantName: restaurant?.name,
    };
  });
}

export async function createTicket(req: Request, res: Response) {
  const input = req.body as CreateTicketInput;
  const user = req.user!;

  // Restaurant-scoped staff always get their own tenant, server-derived — never trusted from
  // the body. Only when the requester has no restaurantId of their own (customers, or
  // platform_admin) is a submitted restaurantId even considered, and even then it's validated
  // to reference a real restaurant rather than trusted outright.
  let restaurantId: string | undefined = user.restaurantId;
  if (!restaurantId && input.restaurantId) {
    const restaurant = await Restaurant.findById(input.restaurantId, "_id");
    if (!restaurant) throw ApiError.badRequest("Unknown restaurantId");
    restaurantId = restaurant.id;
  }

  const ticketNumber = await nextTicketNumber();
  const ticket = await SupportTicket.create({
    ticketNumber,
    subject: input.subject,
    description: input.description,
    category: input.category,
    priority: input.priority,
    source: input.context?.app === "admin" ? "admin" : "help_widget",
    createdBy: user.id,
    restaurantId,
    context: input.context
      ? { ...input.context, userAgent: (req.headers["user-agent"] ?? "").slice(0, 300) }
      : { userAgent: (req.headers["user-agent"] ?? "").slice(0, 300) },
    statusHistory: [{ status: "open", at: new Date() }],
  });

  await SupportMessage.create({
    ticketId: ticket._id,
    authorId: user.id,
    authorType: authorTypeFor(user.role),
    content: input.description,
    isInternal: false,
  });

  sendSuccess(res, { ticket: ticket.toJSON() }, 201);
  emitTicketEvent("ticket.created", {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    createdBy: user.id,
    restaurantId,
    status: "open",
  });
}

export async function listMyTickets(req: Request, res: Response) {
  const tickets = await SupportTicket.find({ createdBy: req.user!.id }).sort({ createdAt: -1 });
  sendSuccess(res, { tickets: tickets.map((t) => t.toJSON()) });
}

export async function getTicket(req: Request, res: Response) {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound("Ticket not found");

  const access = await getTicketAccess(ticket, req.user!);
  if (!access.isOwner && !access.isStaff) throw ApiError.forbidden();

  const [enriched] = access.isStaff ? await enrichTickets([ticket]) : [ticket.toJSON()];
  sendSuccess(res, { ticket: enriched });
}

export async function getTicketMessages(req: Request, res: Response) {
  const ticket = await SupportTicket.findById(req.params.id, "createdBy restaurantId");
  if (!ticket) throw ApiError.notFound("Ticket not found");

  const access = await getTicketAccess(ticket, req.user!);
  if (!access.isOwner && !access.isStaff) throw ApiError.forbidden();

  // The enforcement point: internal notes are excluded by the MongoDB query itself for any
  // caller who isn't authorized to see them — not filtered after the fact in the controller or
  // (worse) left to the frontend to hide.
  const filter: Record<string, unknown> = { ticketId: ticket._id };
  if (!access.canSeeInternal) filter.isInternal = { $ne: true };

  const messages = await SupportMessage.find(filter).sort({ createdAt: 1 });
  sendSuccess(res, { messages: messages.map((m) => m.toJSON()) });
}

export async function createTicketMessage(req: Request, res: Response) {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound("Ticket not found");

  const access = await getTicketAccess(ticket, req.user!);
  if (!access.isOwner && !access.isStaff) throw ApiError.forbidden();
  if (ticket.status === "closed") throw ApiError.badRequest("This ticket is closed and no longer accepts replies");

  const input = req.body as CreateTicketMessageInput;
  const wantsInternal = input.isInternal === true;
  if (wantsInternal && !access.canSeeInternal) {
    throw ApiError.forbidden("You are not authorized to add internal notes");
  }

  const message = await SupportMessage.create({
    ticketId: ticket._id,
    authorId: req.user!.id,
    authorType: authorTypeFor(req.user!.role),
    content: input.content,
    isInternal: wantsInternal,
  });

  // A customer's own follow-up on a ticket that's waiting on them (or was already marked
  // resolved) is exactly the signal that moves it back into the active queue — an automatic,
  // narrowly-scoped side effect of THEIR OWN reply, never a status value they submit directly.
  let statusChanged = false;
  if (access.isOwner && !wantsInternal) {
    const reopenTo = ticket.status === "resolved" ? "open" : ticket.status === "waiting_customer" ? "in_progress" : null;
    if (reopenTo) {
      ticket.status = reopenTo;
      ticket.statusHistory.push({ status: reopenTo, at: new Date() });
      await ticket.save();
      statusChanged = true;
    }
  }

  sendSuccess(res, { message: message.toJSON() }, 201);

  const restaurantId = ticket.restaurantId?.toString();
  emitTicketEvent("ticket.message.created", {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    createdBy: ticket.createdBy.toString(),
    restaurantId,
    status: ticket.status,
    isInternalMessage: wantsInternal,
  });
  if (statusChanged) {
    emitTicketEvent("ticket.status.changed", {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      createdBy: ticket.createdBy.toString(),
      restaurantId,
      status: ticket.status,
    });
  }
}

/**
 * Customer-only, narrower than the general status endpoint — deliberately mirrors
 * cancelMyOrder's self-service pattern: the ticket's own creator confirming their issue is
 * actually resolved, nothing else.
 */
export async function confirmResolution(req: Request, res: Response) {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound("Ticket not found");
  if (ticket.createdBy.toString() !== req.user!.id) throw ApiError.forbidden();
  if (ticket.status !== "resolved") {
    throw ApiError.badRequest(`Only a resolved ticket can be confirmed closed — this one is "${ticket.status}"`);
  }

  ticket.status = "closed";
  ticket.closedAt = new Date();
  ticket.statusHistory.push({ status: "closed", at: ticket.closedAt });
  await ticket.save();

  sendSuccess(res, { ticket: ticket.toJSON() });
  emitTicketEvent("ticket.status.changed", {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    createdBy: ticket.createdBy.toString(),
    restaurantId: ticket.restaurantId?.toString(),
    status: "closed",
  });
}

/** Restaurant-scoped staff view — requireTenantMatch already confirmed the caller's own tenant. */
export async function listRestaurantTickets(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const { status, priority, category } = req.query as { status?: string; priority?: string; category?: string };
  const filter: Record<string, unknown> = { restaurantId };
  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (category) filter.category = category;

  const tickets = await SupportTicket.find(filter).sort({ createdAt: -1 });
  sendSuccess(res, { tickets: await enrichTickets(tickets) });
}

/** Platform-wide dashboard list — platform_admin only. */
export async function listAdminTickets(req: Request, res: Response) {
  const { status, priority, category, assignedTo, restaurantId } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (category) filter.category = category;
  if (assignedTo) filter.assignedTo = assignedTo;
  if (restaurantId) filter.restaurantId = restaurantId;

  const tickets = await SupportTicket.find(filter).sort({ createdAt: -1 }).limit(200);
  sendSuccess(res, { tickets: await enrichTickets(tickets) });
}

export async function updateTicketStatus(req: Request, res: Response) {
  const { status: nextStatus } = req.body as UpdateTicketStatusInput;
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound("Ticket not found");

  if (!isValidTicketTransition(ticket.status, nextStatus)) {
    throw ApiError.badRequest(`Cannot move a ticket from "${ticket.status}" to "${nextStatus}"`);
  }

  ticket.status = nextStatus;
  ticket.statusHistory.push({ status: nextStatus, at: new Date() });
  if (nextStatus === "resolved") ticket.resolvedAt = new Date();
  if (nextStatus === "closed") ticket.closedAt = new Date();
  await ticket.save();

  sendSuccess(res, { ticket: ticket.toJSON() });
  emitTicketEvent("ticket.status.changed", {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    createdBy: ticket.createdBy.toString(),
    restaurantId: ticket.restaurantId?.toString(),
    status: nextStatus,
  });
}

export async function updateTicketPriority(req: Request, res: Response) {
  const { priority } = req.body as UpdateTicketPriorityInput;
  const ticket = await SupportTicket.findByIdAndUpdate(
    req.params.id,
    { $set: { priority } },
    { new: true, runValidators: true }
  );
  if (!ticket) throw ApiError.notFound("Ticket not found");
  sendSuccess(res, { ticket: ticket.toJSON() });
}

export async function assignTicket(req: Request, res: Response) {
  const { assignedTo } = req.body as AssignTicketInput;

  if (assignedTo) {
    const assignee = await User.findById(assignedTo, "role");
    if (!assignee || assignee.role !== "platform_admin") {
      throw ApiError.badRequest("assignedTo must reference an existing platform_admin user");
    }
  }

  const update = assignedTo ? { $set: { assignedTo } } : { $unset: { assignedTo: "" } };
  const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  if (!ticket) throw ApiError.notFound("Ticket not found");

  sendSuccess(res, { ticket: ticket.toJSON() });
  emitTicketEvent("ticket.assigned", {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    createdBy: ticket.createdBy.toString(),
    restaurantId: ticket.restaurantId?.toString(),
    status: ticket.status,
  });
}

export async function getSupportAnalytics(_req: Request, res: Response) {
  const [open, inProgress, waitingCustomer, resolved, highPriority] = await Promise.all([
    SupportTicket.countDocuments({ status: "open" }),
    SupportTicket.countDocuments({ status: "in_progress" }),
    SupportTicket.countDocuments({ status: "waiting_customer" }),
    SupportTicket.countDocuments({ status: "resolved" }),
    SupportTicket.countDocuments({ priority: { $in: ["high", "urgent"] }, status: { $nin: ["resolved", "closed"] } }),
  ]);
  sendSuccess(res, { analytics: { open, inProgress, waitingCustomer, resolved, highPriority } });
}
