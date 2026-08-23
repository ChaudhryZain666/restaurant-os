import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  MONGO_URI: z.string().min(1, "MONGO_URI is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 chars"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  ADMIN_ORIGIN: z.string().default("http://localhost:5174"),

  // File storage (optional — StorageService throws only when actually used unconfigured)
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_REGION: z.string().optional(),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
  STORAGE_PUBLIC_URL: z.string().optional(),

  // Email (optional — unset or "console" logs the rendered email instead of sending it; see
  // apps/api/src/email/index.ts. No real provider is wired up yet — this is the extension point).
  EMAIL_PROVIDER: z.enum(["console", "smtp"]).default("console"),
  EMAIL_FROM: z.string().default("Tablecloth <no-reply@tablecloth.local>"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  // Geocoding (optional — GeocodingService throws only when actually used unconfigured, never at
  // boot; see apps/api/src/services/geocoding/index.ts). "locationiq" is the real provider (see
  // docs/delivery-architecture.md for why) and requires GEOCODING_API_KEY. "test" is a
  // deterministic, no-network adapter safe for any environment without real credentials — used by
  // this project's own Jest/Playwright suites and reasonable for local dev too.
  GEOCODING_PROVIDER: z.enum(["locationiq", "test"]).optional(),
  GEOCODING_API_KEY: z.string().optional(),
  // Override only for testing against a different host (e.g. a self-hosted LocationIQ-compatible
  // proxy) — defaults to LocationIQ's real API host when unset.
  GEOCODING_BASE_URL: z.string().optional(),

  // Payments. "mock" is the only provider that actually runs — deterministic, no real money ever
  // moves, see apps/api/src/payments/MockPaymentProvider.ts. "safepay" names the real provider
  // decision documented in docs/payment-provider-decision.md; selecting it without an
  // implementation throws clearly (getPaymentProvider in payments/index.ts) rather than silently
  // falling back to the mock. SAFEPAY_* are accepted but unused today — the configuration
  // boundary a real adapter would read from, not a working credential path.
  PAYMENT_PROVIDER: z.enum(["mock", "safepay"]).default("mock"),
  MOCK_PAYMENT_WEBHOOK_SECRET: z.string().default("mock-payment-webhook-secret-dev-only"),
  // Safepay: real network-capable adapter as of Phase 15 (apps/api/src/payments/SafepayProvider.ts),
  // but never exercised against a live account — see that file's header comment and
  // docs/payment-provider-decision.md for exactly what's verified vs. assumed. SAFEPAY_ENV picks
  // which of Safepay's two real hosts to call; defaults to "sandbox" so an incomplete deployment
  // config can never silently reach their production host.
  SAFEPAY_API_KEY: z.string().optional(),
  SAFEPAY_SECRET_KEY: z.string().optional(),
  SAFEPAY_WEBHOOK_SECRET: z.string().optional(),
  SAFEPAY_ENV: z.enum(["sandbox", "production"]).default("sandbox"),

  // DNS verification (Phase 22 custom domains). "mock" (default outside production, mirroring
  // PAYMENT_PROVIDER's default-mock precedent) reads from the MockDnsRecord collection, seeded
  // directly via Mongo — the same documented exception this project already uses for e2e tests
  // reading real invite tokens directly from Mongo instead of a real inbox. "node" performs real
  // DNS TXT lookups (apps/api/src/dns/NodeDnsVerifier.ts) and is the only provider that should ever
  // be selected in production.
  DNS_VERIFIER: z.enum(["mock", "node"]).default("mock"),

  // Billing (Phase 24 platform subscriptions — deliberately separate from PAYMENT_PROVIDER above,
  // a different financial domain). "mock" is the only valid value this phase and the only one that
  // actually runs — see apps/api/src/billing/MockBillingProvider.ts. No real billing provider is
  // integrated; this env var exists so a real one can be added later without touching any call site.
  BILLING_PROVIDER: z.enum(["mock"]).default("mock"),
  MOCK_BILLING_WEBHOOK_SECRET: z.string().default("mock-billing-webhook-secret-dev-only"),
  // No final trial-length commercial decision has been made — this stays configuration, never a
  // hardcoded literal in application code. 14 here is a working default for local development/
  // testing only, not a commercial decision (see docs' Phase 24 "commercial decisions required" list).
  TRIAL_PERIOD_DAYS: z.coerce.number().int().min(0).default(14),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
