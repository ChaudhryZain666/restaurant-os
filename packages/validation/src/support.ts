import { z } from "zod";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from "@restaurant/types";

export const createTicketSchema = z.object({
  subject: z.string().min(3).max(200),
  description: z.string().min(1).max(5000),
  category: z.enum(TICKET_CATEGORIES).default("other"),
  priority: z.enum(TICKET_PRIORITIES).default("normal"),
  // Only meaningful when the authenticated user has no restaurantId of their own (customers) —
  // ignored server-side for restaurant-scoped staff, who always get their own tenant's ID
  // instead. Validated to reference a real, active restaurant before being trusted as context.
  restaurantId: z.string().optional(),
  context: z
    .object({
      app: z.enum(["web", "admin"]).optional(),
      route: z.string().max(200).optional(),
    })
    .optional(),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const createTicketMessageSchema = z.object({
  content: z.string().min(1).max(5000),
  // Only ever honored if the requester has support.tickets.internal_notes — enforced in the
  // controller, not just here; this schema only ensures the field is boolean-shaped.
  isInternal: z.boolean().default(false),
});
export type CreateTicketMessageInput = z.infer<typeof createTicketMessageSchema>;

export const updateTicketStatusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
});
export type UpdateTicketStatusInput = z.infer<typeof updateTicketStatusSchema>;

export const updateTicketPrioritySchema = z.object({
  priority: z.enum(TICKET_PRIORITIES),
});
export type UpdateTicketPriorityInput = z.infer<typeof updateTicketPrioritySchema>;

export const assignTicketSchema = z.object({
  assignedTo: z.string().min(1).nullable(),
});
export type AssignTicketInput = z.infer<typeof assignTicketSchema>;
