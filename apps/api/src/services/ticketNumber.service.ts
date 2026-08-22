import { Counter } from "../models/Counter.js";

const STARTING_SEQUENCE = 1000;
const TICKET_COUNTER_ID = "ticket-global";

/**
 * Tickets aren't restaurant-scoped the way orders are (a ticket may have no restaurantId at
 * all — a general account question), so this is one global sequence rather than one per
 * restaurant. No transaction session needed: unlike order creation, a ticket write doesn't need
 * to be atomic with anything else.
 */
export async function nextTicketNumber(): Promise<string> {
  const counter = await Counter.findOneAndUpdate(
    { _id: TICKET_COUNTER_ID },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `TKT-${STARTING_SEQUENCE + counter.seq}`;
}
