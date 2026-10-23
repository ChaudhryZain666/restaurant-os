/**
 * Lane A — moves the live demo (`/r/demo-restaurant`) from its placeholder owner to an existing
 * platform-admin account, so that admin can run the demo's menu, orders and settings from the admin
 * app (Platform → Restaurants → the demo → "Manage this restaurant"). The admin keeps its
 * platform_admin role; no account is created, merged or deleted. See
 * services/productionDemo.service.ts's transferDemoOwnership for exactly what changes and what it
 * refuses, and docs/production-launch-checklist.md for the production procedure.
 *
 * Usage (production, from apps/api after `npm run build`):
 *   node dist/scripts/transferDemoOwnership.js --admin-email you@example.com            # transfer
 *   node dist/scripts/transferDemoOwnership.js --admin-email you@example.com --revert   # undo
 * Usage (development): npx tsx src/scripts/transferDemoOwnership.ts --admin-email ... [--revert]
 *
 * Idempotent: running it again reports "already done". Exit code 0 on success or no-op; 1 when
 * refused (nothing changed) or on any error.
 */
import mongoose from "mongoose";
import { z } from "zod";
import { connectDB } from "../config/db.js";
import { DemoProvisioningConflictError, transferDemoOwnership } from "../services/productionDemo.service.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const parsed = z.object({ adminEmail: z.string().email() }).safeParse({ adminEmail: arg("admin-email") });
  if (!parsed.success) {
    console.error("[demo:transfer-owner] Usage: --admin-email you@example.com [--revert]");
    process.exit(1);
  }
  const revert = process.argv.includes("--revert");

  await connectDB();
  try {
    const result = await transferDemoOwnership({ adminEmail: parsed.data.adminEmail, revert });
    const what = revert ? "back to the placeholder owner" : `to ${parsed.data.adminEmail}`;
    console.log(
      result.changed
        ? `[demo:transfer-owner] Demo ownership moved ${what} (${result.restaurantIds.length} location(s)). Undo with ${revert ? "the same command without --revert" : "--revert"}.`
        : `[demo:transfer-owner] Already done — the demo is owned ${what}. Nothing changed.`
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof DemoProvisioningConflictError ? `[demo:transfer-owner] REFUSED: ${err.message}` : err);
  process.exit(1);
});
