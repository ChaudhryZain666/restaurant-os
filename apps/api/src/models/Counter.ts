import { Schema, model } from "mongoose";

/**
 * One counter document per sequence (_id = the sequence's key), incremented atomically via
 * findOneAndUpdate's $inc — the standard MongoDB pattern for race-free sequence numbers.
 * _id is Mixed rather than ObjectId because not every sequence is tenant-scoped: order numbers
 * key by restaurantId (an ObjectId), while ticket numbers (see ticketNumber.service.ts) are a
 * single global sequence keyed by a fixed string. Not tenant-filtered by a separate field
 * because the _id itself *is* the sequence's key.
 */
const counterSchema = new Schema({
  _id: { type: Schema.Types.Mixed },
  seq: { type: Number, default: 0 },
});

export const Counter = model("Counter", counterSchema);
