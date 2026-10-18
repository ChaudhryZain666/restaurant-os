/**
 * Lane A — gives a GarnishTable team member a SEPARATE manager login for the live demo storefront
 * (`/r/demo-restaurant`), so they can run and show the demo without merging the demo's placeholder
 * owner into their own account. Their platform-admin account is not touched. See
 * services/productionDemo.service.ts's inviteDemoManager for exactly what it creates and refuses.
 *
 * The email must NOT already have a GarnishTable account (use e.g. a plus-address of your own).
 * An invite link is emailed to it; the password is set by the invitee and never passes through here.
 *
 * Usage (production, from apps/api after `npm run build`):
 *   node dist/scripts/inviteDemoManager.js --email you+demo@example.com --name "Your Name"
 * Usage (development):
 *   npx tsx src/scripts/inviteDemoManager.ts --email you+demo@example.com --name "Your Name"
 *
 * Exit code 0 when the invite was sent; 1 when refused or on any error (nothing is kept).
 */
import mongoose from "mongoose";
import { z } from "zod";
import { connectDB } from "../config/db.js";
import { DemoProvisioningConflictError, inviteDemoManager } from "../services/productionDemo.service.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const parsed = z
    .object({ email: z.string().email(), name: z.string().min(2).max(80) })
    .safeParse({ email: arg("email"), name: arg("name") });
  if (!parsed.success) {
    console.error('[demo:invite-manager] Usage: --email you+demo@example.com --name "Your Name"');
    process.exit(1);
  }

  await connectDB();
  try {
    const { restaurantId } = await inviteDemoManager(parsed.data);
    console.log(`[demo:invite-manager] Invite sent to ${parsed.data.email} for the demo restaurant (${restaurantId}).`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof DemoProvisioningConflictError ? `[demo:invite-manager] REFUSED: ${err.message}` : err);
  process.exit(1);
});
