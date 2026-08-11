import { Schema, model } from "mongoose";

/**
 * One counter document per restaurant (_id = restaurantId), incremented atomically via
 * findOneAndUpdate's $inc — the standard MongoDB pattern for race-free sequence numbers.
 * Not tenant-filtered by a separate field because the _id itself *is* the tenant key.
 */
const counterSchema = new Schema({
  _id: { type: Schema.Types.ObjectId },
  seq: { type: Number, default: 0 },
});

export const Counter = model("Counter", counterSchema);
