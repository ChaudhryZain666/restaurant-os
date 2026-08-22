import type { TicketStatus } from "@restaurant/types";

/**
 * Explicit allowed transitions per status, mirroring orderStateMachine.ts's shape. "closed" is
 * terminal for staff-driven transitions; a customer replying to a resolved/waiting_customer
 * ticket is handled as a separate, narrower side effect in the reply endpoint itself (not a
 * client-supplied status value), not modeled as a general transition here.
 */
const TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["waiting_customer", "resolved", "closed"],
  waiting_customer: ["in_progress", "open", "resolved", "closed"],
  resolved: ["closed", "open", "in_progress"],
  closed: [],
};

export function isValidTicketTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalTicketStatus(status: TicketStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
