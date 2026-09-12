import { env } from "../../config/env.js";
import type { PaymentTerminalProvider } from "./PaymentTerminalProvider.js";
import { MockTerminalProvider } from "./MockTerminalProvider.js";
import { ApiError } from "../../utils/ApiError.js";

let instance: PaymentTerminalProvider | null = null;

/**
 * Phase 74 — mirrors ../index.ts's getPaymentProvider() lazy-singleton pattern. Unlike that
 * registry, "none" is a real, first-class, DEFAULT resolved value here — most of the time this
 * should never even be called (posTerminalPayment.service.ts checks
 * env.POS_TERMINAL_PROVIDER !== "none" and the location's own settings.posTerminalEnabled BEFORE
 * reaching here), but if it ever is, it throws a clear, expected 400 rather than a confusing
 * internal error, so a bug in that earlier gate fails safely instead of silently.
 */
export function getPosTerminalProvider(): PaymentTerminalProvider {
  if (env.POS_TERMINAL_PROVIDER === "none") {
    throw ApiError.badRequest("No POS card-terminal provider is configured for this deployment.");
  }
  if (instance) return instance;
  instance = new MockTerminalProvider();
  return instance;
}

/** Test/dev-only accessor for the mock provider's driver surface (simulateOutcome) — throws if the
 *  configured provider isn't mock, mirroring ../index.ts's getMockPaymentProvider(). */
export function getMockTerminalProvider(): MockTerminalProvider {
  const provider = getPosTerminalProvider();
  if (!(provider instanceof MockTerminalProvider)) {
    throw new Error("The mock POS terminal driver is only available when POS_TERMINAL_PROVIDER=mock.");
  }
  return provider;
}
