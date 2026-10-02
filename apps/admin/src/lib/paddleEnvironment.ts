/**
 * Phase 85A — which Paddle environment Paddle.js is initialised for. Previously hardcoded to
 * "sandbox", which made a production checkout impossible.
 *
 * The API is the single source of truth: every overlay checkout session carries the `environment`
 * of the Paddle host the API itself talks to (PaddleBillingProvider.environment, from PADDLE_ENV),
 * and a production API refuses to boot with Paddle on sandbox (apps/api env.ts). This side never
 * picks or defaults an environment — a session without a valid one fails loudly instead of quietly
 * opening a sandbox checkout. The client-side token's own prefix ("test_" sandbox, "live_" live) is
 * cross-checked so a token from the other environment can't slip through either.
 */
export type PaddleEnvironment = "sandbox" | "production";

export class PaddleConfigurationError extends Error {
  constructor(detail: string) {
    super(`Checkout is misconfigured and was not opened: ${detail} Please contact support.`);
    this.name = "PaddleConfigurationError";
  }
}

export interface PaddleCheckoutSessionConfig {
  environment?: unknown;
  clientToken?: string;
}

const TOKEN_PREFIX_ENVIRONMENT: Array<[prefix: string, environment: PaddleEnvironment]> = [
  ["test_", "sandbox"],
  ["live_", "production"],
];

export function resolvePaddleEnvironment(session: PaddleCheckoutSessionConfig): PaddleEnvironment {
  const { environment, clientToken } = session;
  if (environment !== "sandbox" && environment !== "production") {
    throw new PaddleConfigurationError(
      environment === undefined
        ? "the server did not say which Paddle environment to use."
        : `"${String(environment)}" is not a Paddle environment.`
    );
  }
  if (!clientToken) {
    throw new PaddleConfigurationError("no Paddle client token was provided.");
  }
  for (const [prefix, tokenEnvironment] of TOKEN_PREFIX_ENVIRONMENT) {
    if (clientToken.startsWith(prefix) && tokenEnvironment !== environment) {
      throw new PaddleConfigurationError(`a ${tokenEnvironment} client token was paired with the ${environment} environment.`);
    }
  }
  return environment;
}
