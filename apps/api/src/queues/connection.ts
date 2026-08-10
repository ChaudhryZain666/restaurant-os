import { Redis } from "ioredis";
import { env } from "../config/env.js";

/** BullMQ requires its own Redis connection with maxRetriesPerRequest: null. */
export const queueConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});
