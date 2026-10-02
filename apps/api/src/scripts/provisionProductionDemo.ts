/**
 * Phase 85A — creates the marketing site's live demo storefront (`/r/demo-restaurant`, Wildwood
 * Kitchen) if it doesn't exist yet. Safe for production and safe to re-run: see
 * services/productionDemo.service.ts for exactly what it creates and what it refuses to touch.
 * NOT scripts/seed-demo-data.ts, which is development-only.
 *
 * Usage (production, from apps/api after `npm run build`):  node dist/scripts/provisionProductionDemo.js
 * Usage (development):                                       npm run --workspace apps/api demo:provision
 *
 * Exit code 0 when the demo exists afterwards; 1 on a slug conflict or any error.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { DemoProvisioningConflictError, provisionProductionDemo } from "../services/productionDemo.service.js";

async function main() {
  await connectDB();
  try {
    const { restaurantId, created } = await provisionProductionDemo();
    console.log(`[demo:provision] demo-restaurant ready (restaurant ${restaurantId}). Created: ${JSON.stringify(created)}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof DemoProvisioningConflictError ? `[demo:provision] REFUSED: ${err.message}` : err);
  process.exit(1);
});
