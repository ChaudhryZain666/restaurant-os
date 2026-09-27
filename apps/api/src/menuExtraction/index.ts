import { env } from "../config/env.js";
import { logger } from "../common/logger.js";
import type { MenuExtractionProvider } from "./MenuExtractionProvider.js";
import { MockMenuExtractionProvider } from "./MockMenuExtractionProvider.js";
import { ClaudeMenuExtractionProvider } from "./ClaudeMenuExtractionProvider.js";

let instance: MenuExtractionProvider | null = null;

function buildLiveProvider(): MenuExtractionProvider {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('Provider "claude" requires ANTHROPIC_API_KEY to be set.');
  }
  return new ClaudeMenuExtractionProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
}

/** Extracted as pure logic (no dependency on the `env` singleton) specifically so this decision is
 *  directly unit-testable without a bigger dependency-injection refactor of the factory below —
 *  mirrors checkRedisVersion.ts's own "extract the pure part, test that" approach. */
export function shouldWarnAboutMockInProduction(nodeEnv: string, mode: string): boolean {
  return nodeEnv === "production" && mode === "mock";
}

/**
 * Lazy singleton, mirroring payments/index.ts's getPaymentProvider() and marketplaceProviders/
 * index.ts's MARKETPLACE_PROVIDER_MODE=mock switch: never throws at boot, only when actually used
 * unconfigured. No per-name registry (unlike payments/marketplace) — there is exactly one logical
 * extraction capability to pick a mode for, not several named external providers to choose between.
 *
 * Phase 82 hardening — unlike a misconfigured payment/storage provider (which fails LOUDLY the
 * moment it's used), a forgotten MENU_EXTRACTION_PROVIDER_MODE=live in production fails SILENTLY
 * WRONG: the mock provider still "succeeds," producing plausible-looking placeholder rows (e.g.
 * "Sample Dish A") that a busy owner could review, not notice, and publish straight onto their
 * real, live, customer-facing menu. This is deliberately a loud warning, not a hard boot-time
 * block (unlike checkRedisVersion.ts's own production gate) — PDF/photo import via AI extraction
 * is genuinely optional functionality (a restaurant can use CSV import or the manual builder
 * instead), so forcing every production deployment to configure real Anthropic credentials even
 * if it never uses this specific feature would be disproportionate.
 */
export function getMenuExtractionProvider(): MenuExtractionProvider {
  if (instance) return instance;
  if (shouldWarnAboutMockInProduction(env.NODE_ENV, env.MENU_EXTRACTION_PROVIDER_MODE)) {
    logger.warn(
      "[menuExtraction] Running the MOCK menu-extraction provider in production — every PDF/photo import will produce fake placeholder items, not real extracted menu data. Set MENU_EXTRACTION_PROVIDER_MODE=live and ANTHROPIC_API_KEY to use real extraction."
    );
  }
  instance = env.MENU_EXTRACTION_PROVIDER_MODE === "mock" ? new MockMenuExtractionProvider() : buildLiveProvider();
  return instance;
}

/** Test-only injection/reset point — mirrors setStorageServiceForTests. */
export function setMenuExtractionProviderForTests(provider: MenuExtractionProvider | undefined): void {
  instance = provider ?? null;
}

export * from "./MenuExtractionProvider.js";
