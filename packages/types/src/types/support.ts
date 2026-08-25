export const TICKET_STATUSES = ["open", "in_progress", "waiting_customer", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * Phase 28 — the single source of truth for valid status transitions, shared by the backend
 * (apps/api/src/services/ticketStateMachine.ts re-exports this unchanged) and the admin frontend
 * (SupportTicketDetailPage.tsx filters its status dropdown to these). Before this, the UI offered
 * every status unconditionally and the backend silently rejected disallowed ones with a 400 — this
 * is what fixes that: one map, read by both sides, so they can't drift apart again. "closed" is
 * terminal for staff-driven transitions.
 */
export const TICKET_STATUS_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["waiting_customer", "resolved", "closed"],
  waiting_customer: ["in_progress", "open", "resolved", "closed"],
  resolved: ["closed", "open", "in_progress"],
  closed: [],
};

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_CATEGORIES = [
  "menu",
  "orders",
  "billing",
  "account",
  "technical",
  "data_recovery",
  "other",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_SOURCES = ["help_widget", "support_center", "admin", "system"] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

export interface TicketStatusHistoryEntry {
  status: TicketStatus;
  at: string;
}

/** Lightweight, non-sensitive technical context captured at ticket creation. */
export interface TicketContext {
  app?: "web" | "admin";
  route?: string;
  userAgent?: string;
}

export interface SupportTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  source: TicketSource;
  createdBy: string;
  restaurantId?: string;
  /**
   * Reserved for a future Agency model — always undefined today. No Agency collection exists
   * anywhere in this codebase yet; this field exists only so ticket documents don't need a
   * schema migration once one does. See docs/support-architecture.md.
   */
  agencyId?: string;
  assignedTo?: string;
  context?: TicketContext;
  statusHistory: TicketStatusHistoryEntry[];
  resolvedAt?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** Present only on staff/admin-facing responses. */
  createdByName?: string;
  createdByEmail?: string;
  restaurantName?: string;
  assignedToName?: string;
}

export interface SupportMessage {
  id: string;
  ticketId: string;
  authorId: string;
  authorType: "customer" | "support";
  content: string;
  /** Never present (message is omitted entirely) in customer-facing responses. */
  isInternal: boolean;
  createdAt: string;
  /** Present only on staff/admin-facing responses. */
  authorName?: string;
}

/** The support identity a customer-facing UI should display — see supportIdentity.service.ts. */
export interface SupportIdentity {
  name: string;
  isWhiteLabel: boolean;
}
