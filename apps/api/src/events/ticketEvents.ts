import { EventEmitter } from "node:events";
import type { TicketStatus } from "@restaurant/types";

export type TicketEventType = "ticket.created" | "ticket.message.created" | "ticket.status.changed" | "ticket.assigned";

export interface TicketEventPayload {
  ticketId: string;
  ticketNumber: string;
  createdBy: string;
  restaurantId?: string;
  status: TicketStatus;
  /** Only meaningful for ticket.message.created — controls which rooms receive the event. */
  isInternalMessage?: boolean;
}

/** Foundation only, mirrors events/orderEvents.ts exactly — see that file's doc-comment. */
export const ticketEventBus = new EventEmitter();

export function emitTicketEvent(type: TicketEventType, payload: TicketEventPayload): void {
  ticketEventBus.emit(type, payload);
}

/**
 * Pure room-selection logic, exported separately so it's unit-testable without a real socket
 * server. This is the single enforcement point for "an internal note must never be pushed to
 * the ticket's creator or restaurant room" — every consumer of ticket events (sockets, and any
 * future notification dispatcher) must route through this function rather than reimplementing
 * the room list, so this rule can't be silently bypassed by a new call site.
 */
export function roomsForTicketEvent(payload: TicketEventPayload): string[] {
  const rooms = ["support:platform"];
  if (!payload.isInternalMessage) {
    rooms.push(`user:${payload.createdBy}`);
    if (payload.restaurantId) rooms.push(`restaurant:${payload.restaurantId}`);
  }
  return rooms;
}
