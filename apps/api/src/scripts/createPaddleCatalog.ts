import { writeFileSync } from "node:fs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { PaddleBillingProvider } from "../billing/PaddleBillingProvider.js";
import { Plan } from "../models/Plan.js";
import { buildPaddleCatalog, parseCatalogScriptArgs, type CatalogPlan, type PaddleCatalogApi, type PaddleCatalogProduct } from "../services/paddleCatalog.service.js";

/**
 * Pre-launch — creates (or finds) the Paddle products/prices for the named plans and writes their ids
 * to a mapping file for scripts/setPaddlePriceIds.ts. Dry run unless --apply; with --apply it only
 * ever CREATES missing objects (see services/paddleCatalog.service.ts) — it never edits, archives or
 * deletes anything in Paddle, and never touches the database.
 *
 *   node dist/scripts/createPaddleCatalog.js --plans owner_starter,owner_growth,agency_growth_v2 --out /tmp/paddle-prices.json [--apply] [--allow-sandbox]
 *
 * Uses PADDLE_API_KEY/PADDLE_ENV from the environment (the key needs product + price write
 * permission). Refuses a sandbox PADDLE_ENV unless --allow-sandbox. Never prints the API key.
 */
async function main() {
  const { planCodes, out, apply } = parseCatalogScriptArgs(process.argv.slice(2), { paddleEnv: env.PADDLE_ENV, hasApiKey: Boolean(env.PADDLE_API_KEY) });
  const baseUrl = PaddleBillingProvider.baseUrlForEnv(env.PADDLE_ENV);

  async function paddle<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.PADDLE_API_KEY}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; detail?: string }; meta?: { pagination?: { next?: string; has_more?: boolean } } };
    if (!res.ok) throw new Error(`Paddle ${method} ${path.split("?")[0]} → HTTP ${res.status}${json.error?.code ? ` ${json.error.code}` : ""}${json.error?.detail ? `: ${json.error.detail}` : ""}`);
    return (method === "GET" ? json : json.data) as T;
  }

  const api: PaddleCatalogApi = {
    async listProducts() {
      const all: PaddleCatalogProduct[] = [];
      let path = "/products?status=active&include=prices&per_page=200";
      for (let page = 0; page < 20; page++) {
        const json = await paddle<{ data?: PaddleCatalogProduct[]; meta?: { pagination?: { next?: string; has_more?: boolean } } }>("GET", path);
        all.push(...(json.data ?? []));
        const next = json.meta?.pagination?.has_more ? json.meta.pagination.next : undefined;
        if (!next) return all;
        path = next.replace(baseUrl, "");
      }
      throw new Error("Too many Paddle products to list — refusing to guess which exist.");
    },
    createProduct: (body) => paddle<{ id: string }>("POST", "/products", body),
    createPrice: (body) => paddle<{ id: string }>("POST", "/prices", body),
  };

  await connectDB();
  try {
    const plans = (await Plan.find({ code: { $in: planCodes } }).lean()) as unknown as CatalogPlan[];
    const result = await buildPaddleCatalog({ plans, planCodes, api, apply });
    console.log(`[paddle-catalog] Paddle environment: ${env.PADDLE_ENV}`);
    for (const p of result.plans) {
      console.log(`  ${p.planCode}: product ${p.product.action}${p.product.id ? ` ${p.product.id}` : ""}`);
      for (const pr of p.prices) console.log(`    ${pr.interval}: ${pr.action} ${pr.amountCents} ${pr.currency}${pr.id ? ` → ${pr.id}` : ""}`);
    }
    if (result.problems.length) {
      result.problems.forEach((p) => console.error(`  ✗ ${p}`));
      throw new Error(`${result.problems.length} problem(s) found; nothing was created.`);
    }
    if (Object.keys(result.mapping).length) {
      writeFileSync(out, `${JSON.stringify(result.mapping, null, 2)}\n`);
      console.log(`[paddle-catalog] ${result.applied ? "created missing objects; " : ""}mapping written to ${out}. Next: setPaddlePriceIds --file ${out} (dry run first).`);
    } else {
      console.log("[paddle-catalog] dry run — nothing created. Re-run with --apply to create the objects marked 'create'.");
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(`[paddle-catalog] ${(err as Error).message}`);
  process.exit(1);
});
