import { env } from "../config/env.js";
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

/**
 * Lazy singleton, mirroring payments/index.ts's getPaymentProvider() and marketplaceProviders/
 * index.ts's MARKETPLACE_PROVIDER_MODE=mock switch: never throws at boot, only when actually used
 * unconfigured. No per-name registry (unlike payments/marketplace) — there is exactly one logical
 * extraction capability to pick a mode for, not several named external providers to choose between.
 */
export function getMenuExtractionProvider(): MenuExtractionProvider {
  if (instance) return instance;
  instance = env.MENU_EXTRACTION_PROVIDER_MODE === "mock" ? new MockMenuExtractionProvider() : buildLiveProvider();
  return instance;
}

/** Test-only injection/reset point — mirrors setStorageServiceForTests. */
export function setMenuExtractionProviderForTests(provider: MenuExtractionProvider | undefined): void {
  instance = provider ?? null;
}

export * from "./MenuExtractionProvider.js";
