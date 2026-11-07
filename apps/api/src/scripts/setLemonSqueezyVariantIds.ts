import { readFileSync } from "node:fs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { LemonSqueezyBillingProvider } from "../billing/LemonSqueezyBillingProvider.js";
import { applyLemonSqueezyVariantMapping, parseVariantMapping } from "../services/lemonSqueezyVariantMapping.service.js";

/**
 * Writes Lemon Squeezy product/variant ids into the Plan catalog, after checking every one against
 * Lemon Squeezy (see services/lemonSqueezyVariantMapping.service.ts). Dry run unless --apply.
 *
 *   node dist/scripts/setLemonSqueezyVariantIds.js --file /path/to/lemonsqueezy-variants.json [--apply]
 *
 * The file maps plan codes to ids (ids are not secrets):
 *   { "owner_starter": { "productId": "1506851", "monthly": "2346454", "yearly": "2346457" }, … }
 *
 * Uses LEMONSQUEEZY_API_KEY / LEMONSQUEEZY_TEST_MODE from the environment, read-only against Lemon
 * Squeezy. Never prints the API key; writes the database only when every check passes.
 */
const USAGE = "Usage: setLemonSqueezyVariantIds --file <mapping.json> [--apply]";

async function main() {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf("--file");
  const file = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
  const unknown = args.filter((arg, i) => arg.startsWith("--") && arg !== "--file" && arg !== "--apply" && i !== fileIndex + 1);
  if (unknown.length) throw new Error(`Unknown option ${unknown.join(", ")}. ${USAGE}`);
  if (!file || file.startsWith("--")) throw new Error(USAGE);
  if (!env.LEMONSQUEEZY_API_KEY) throw new Error("LEMONSQUEEZY_API_KEY is not set.");
  const apply = args.includes("--apply");

  const { mapping, problems: formatProblems } = parseVariantMapping(JSON.parse(readFileSync(file, "utf-8")));
  if (formatProblems.length) {
    formatProblems.forEach((p) => console.error(`  ✗ ${p}`));
    throw new Error("The mapping file is invalid; nothing was checked or written.");
  }

  const lemonSqueezy = new LemonSqueezyBillingProvider(
    env.LEMONSQUEEZY_API_KEY,
    env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "",
    env.LEMONSQUEEZY_STORE_ID ?? "",
    env.LEMONSQUEEZY_TEST_MODE,
    env.LEMONSQUEEZY_CHECKOUT_SECRET ?? "" // read-only script: never signs a checkout
  );
  await connectDB();
  try {
    const result = await applyLemonSqueezyVariantMapping({
      mapping,
      fetchVariant: (id) => lemonSqueezy.retrieveVariant(id),
      testMode: env.LEMONSQUEEZY_TEST_MODE,
      apply,
    });
    console.log(`[lemonsqueezy-variants] mode: ${env.LEMONSQUEEZY_TEST_MODE ? "test" : "live"}`);
    for (const c of result.productChanges) console.log(`  product  ${c.planCode}: ${c.from ?? "(none)"} → ${c.to}`);
    for (const c of result.priceChanges) console.log(`  variant  ${c.planCode} ${c.interval}: ${c.from ?? "(none)"} → ${c.to}`);
    if (!result.productChanges.length && !result.priceChanges.length) console.log("  (no changes — the catalog already has these ids)");
    if (result.problems.length) {
      result.problems.forEach((p) => console.error(`  ✗ ${p}`));
      throw new Error(`${result.problems.length} problem(s) found; nothing was written.`);
    }
    console.log(result.applied ? "[lemonsqueezy-variants] written." : "[lemonsqueezy-variants] all checks passed — dry run, nothing written. Re-run with --apply.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(`[lemonsqueezy-variants] ${(err as Error).message}`);
  process.exit(1);
});
