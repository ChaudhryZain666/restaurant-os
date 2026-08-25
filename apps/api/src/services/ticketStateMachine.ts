import { TICKET_STATUS_TRANSITIONS, type TicketStatus } from "@restaurant/types";

/**
 * Phase 28 — TICKET_STATUS_TRANSITIONS moved to @restaurant/types (re-exported here unchanged) so
 * the admin frontend can filter its status dropdown to the same allowed transitions instead of
 * discovering them via a 400 from this function. A customer replying to a resolved/waiting_customer
 * ticket is handled as a separate, narrower side effect in the reply endpoint itself (not a
 * client-supplied status value), not modeled as a general transition here.
 */
const TRANSITIONS = TICKET_STATUS_TRANSITIONS;

export function isValidTicketTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalTicketStatus(status: TicketStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
