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
  // Phase 28 — the marketing site (apps/marketing) is a separate, unauthenticated frontend. It only
  // ever calls the new public/* routes (no cookies, no bearer token), but still needs its own CORS
  // origin like CLIENT_ORIGIN/ADMIN_ORIGIN — the dev proxy (apps/marketing/vite.config.ts) already
  // makes local dev same-origin, but a production deployment that serves marketing as a genuinely
  // separate origin (e.g. a static host) needs this.
  MARKETING_ORIGIN: z.string().default("http://localhost:5175"),

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
  // No default (Phase 29 — was a placeholder "Tablecloth <no-reply@tablecloth.local>" address that
  // could silently ship to production if an operator forgot to override it): getEmailService()
  // requires this explicitly whenever EMAIL_PROVIDER=smtp, same fail-loud pattern as SMTP_HOST/PORT.
  // The console provider (dev/test default) never sends anything, so it has no real need for a
  // from-address at all.
  EMAIL_FROM: z.string().optional(),
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
  // moves, see apps/api/src/payments/MockPaymentProvider.ts. "safepay"/"stripe" name real provider
  // decisions (docs/payment-provider-decision.md); selecting either without its credentials throws
  // clearly (getPaymentProvider in payments/index.ts) rather than silently falling back to the
  // mock. This is now the DEFAULT provider only — Phase 34's payments/eligibility.ts can request a
  // specific provider by name per-restaurant (getPaymentProvider(name)), independent of this env
  // var, which still governs the single default used when no name is given (e.g. the mock driver,
  // and any restaurant the eligibility engine can't confidently route).
  PAYMENT_PROVIDER: z.enum(["mock", "safepay", "stripe"]).default("mock"),
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
  // Stripe: Phase 34's second restaurant-payment adapter (apps/api/src/payments/StripeProvider.ts)
  // — real code against Stripe's own documented public API, but still unverified against a live
  // (even test-mode) account in this environment, same status class as Safepay above. Unlike
  // Safepay/Paddle, Stripe test-mode keys are genuinely self-serve with no business verification —
  // see docs/payment-provider-decision.md's Phase 34 addendum.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Phase 34 — opt-in country/currency payment routing (payments/eligibility.ts). Defaults to
  // "false" so every existing deployment/test/dev environment keeps today's exact behavior (every
  // restaurant routed to the single PAYMENT_PROVIDER-configured default, regardless of country) —
  // flipping this on is a deliberate deployment decision for a multi-provider setup, not something
  // that should change behavior merely by adding STRIPE_* credentials. z.enum(["true","false"]),
  // not z.coerce.boolean(), since the latter treats the literal string "false" as truthy.
  PAYMENT_ELIGIBILITY_ROUTING: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // DNS verification (Phase 22 custom domains). "mock" (default outside production, mirroring
  // PAYMENT_PROVIDER's default-mock precedent) reads from the MockDnsRecord collection, seeded
  // directly via Mongo — the same documented exception this project already uses for e2e tests
  // reading real invite tokens directly from Mongo instead of a real inbox. "node" performs real
  // DNS TXT lookups (apps/api/src/dns/NodeDnsVerifier.ts) and is the only provider that should ever
  // be selected in production.
  DNS_VERIFIER: z.enum(["mock", "node"]).default("mock"),

  // Billing (Phase 24 platform subscriptions — deliberately separate from PAYMENT_PROVIDER above,
  // a different financial domain). "mock" is the only provider that actually runs in this
  // project's own tests — see apps/api/src/billing/MockBillingProvider.ts. "paddle" (Phase 27)
  // names the real provider decision (docs/commercial-decisions.md's "Provider choice" section);
  // selecting it without real PADDLE_* credentials throws clearly (getBillingProvider in
  // billing/index.ts) rather than silently falling back to the mock — mirrors PAYMENT_PROVIDER's
  // "safepay" precedent exactly.
  BILLING_PROVIDER: z.enum(["mock", "paddle"]).default("mock"),
  MOCK_BILLING_WEBHOOK_SECRET: z.string().default("mock-billing-webhook-secret-dev-only"),
  // Paddle: real network-capable adapter as of Phase 27 (apps/api/src/billing/
  // PaddleBillingProvider.ts), but never exercised against a live account — see that file's header
  // comment and docs/commercial-decisions.md for exactly what's verified vs. assumed. PADDLE_ENV
  // picks which of Paddle's two real hosts to call; defaults to "sandbox" so an incomplete
  // deployment config can never silently reach their production host.
  PADDLE_API_KEY: z.string().optional(),
  PADDLE_WEBHOOK_SECRET: z.string().optional(),
  PADDLE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  // No final trial-length commercial decision has been made — this stays configuration, never a
  // hardcoded literal in application code. 14 here is a working default for local development/
  // testing only, not a commercial decision (see docs/commercial-decisions.md). A Plan's own
  // trialDays (Phase 27) overrides this per-plan when set.
  TRIAL_PERIOD_DAYS: z.coerce.number().int().min(0).default(14),
  // Phase 27 — how long a "past_due" subscription keeps full access before auto-transitioning to
  // "cancelled" if the provider never reports recovery. No final policy decision has been made
  // (see docs/commercial-decisions.md's "Failed-payment policy" section) — this is a working,
  // documented-non-final default, mirroring TRIAL_PERIOD_DAYS's exact precedent.
  PAST_DUE_GRACE_PERIOD_DAYS: z.coerce.number().int().min(0).default(7),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
