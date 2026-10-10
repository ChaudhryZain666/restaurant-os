import { readFileSync } from "node:fs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { PaddleBillingProvider } from "../billing/PaddleBillingProvider.js";
import { applyPaddlePriceMapping, parsePriceMapping, parsePriceScriptArgs, type PaddlePrice } from "../services/paddlePriceMapping.service.js";

/**
 * Phase 89 — writes the real Paddle product/price ids into the Plan catalog, after checking every
 * one against Paddle (see services/paddlePriceMapping.service.ts). Dry run unless --apply.
 *
 *   node dist/scripts/setPaddlePriceIds.js --file /path/to/paddle-prices.json [--apply] [--allow-sandbox]
 *
 * The file maps plan codes to ids (ids are not secrets):
 *   { "owner_starter": { "productId": "pro_…", "monthly": "pri_…", "yearly": "pri_…" }, … }
 *
 * Uses PADDLE_API_KEY/PADDLE_ENV from the environment, read-only against Paddle. Refuses a sandbox
 * PADDLE_ENV unless --allow-sandbox (for rehearsing against the sandbox catalog). Never prints the
 * API key; writes nothing to Paddle; writes the database only when every check passes.
 */
async function main() {
  const { file, apply } = parsePriceScriptArgs(process.argv.slice(2), { paddleEnv: env.PADDLE_ENV, hasApiKey: Boolean(env.PADDLE_API_KEY) });

  const { mapping, problems: formatProblems } = parsePriceMapping(JSON.parse(readFileSync(file, "utf-8")));
  if (formatProblems.length) {
    formatProblems.forEach((p) => console.error(`  ✗ ${p}`));
    throw new Error("The mapping file is invalid; nothing was checked or written.");
  }

  const paddle = new PaddleBillingProvider(env.PADDLE_API_KEY!, env.PADDLE_WEBHOOK_SECRET ?? "", PaddleBillingProvider.baseUrlForEnv(env.PADDLE_ENV));
  await connectDB();
  try {
    const result = await applyPaddlePriceMapping({
      mapping,
      fetchPrice: async (id) => (await paddle.retrievePrice(id)) as PaddlePrice | null,
      apply,
    });
    console.log(`[paddle-prices] Paddle environment: ${env.PADDLE_ENV}`);
    for (const c of result.productChanges) console.log(`  product  ${c.planCode}: ${c.from ?? "(none)"} → ${c.to}`);
    for (const c of result.priceChanges) console.log(`  price    ${c.planCode} ${c.interval}: ${c.from ?? "(none)"} → ${c.to}`);
    if (!result.productChanges.length && !result.priceChanges.length) console.log("  (no changes — the catalog already has these ids)");
    if (result.problems.length) {
      result.problems.forEach((p) => console.error(`  ✗ ${p}`));
      throw new Error(`${result.problems.length} problem(s) found; nothing was written.`);
    }
    console.log(result.applied ? "[paddle-prices] written." : "[paddle-prices] all checks passed — dry run, nothing written. Re-run with --apply.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(`[paddle-prices] ${(err as Error).message}`);
  process.exit(1);
});
