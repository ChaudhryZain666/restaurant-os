import type { ClientSession, Types } from "mongoose";
import { Counter } from "../models/Counter.js";

const STARTING_SEQUENCE = 1000;

/**
 * Atomically allocates the next order number for a restaurant using MongoDB's
 * findOneAndUpdate($inc) — the standard race-free counter pattern. Run inside the same
 * transaction session as the order write so a rolled-back order doesn't "waste" leaving a
 * detectable gap from a concurrent successful order (both still commit their own numbers
 * atomically; this just keeps counter and order creation consistent as one unit of work).
 */
export async function nextOrderNumber(restaurantId: Types.ObjectId, session: ClientSession): Promise<string> {
  const counter = await Counter.findOneAndUpdate(
    { _id: restaurantId },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );
  return `ORD-${STARTING_SEQUENCE + counter.seq}`;
}
