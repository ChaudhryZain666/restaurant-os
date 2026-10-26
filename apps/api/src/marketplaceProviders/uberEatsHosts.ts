/**
 * The two Uber Eats environments, kept strictly apart (developer.uber.com/docs/eats/guides/sandbox):
 * a token is only valid on the API domain of the environment that issued it, and a TESTING app's
 * credentials only work in the sandbox. Every Uber Eats URL in this codebase is built from one of
 * these — never a hardcoded host — so switching environment can't leave one call on the other side.
 */
export type UberEatsEnvironment = "sandbox" | "production";

export interface UberEatsHosts {
  environment: UberEatsEnvironment;
  /** OAuth host: /oauth/v2/token and /oauth/v2/authorize live here. */
  authBaseUrl: string;
  /** API host: /v1/eats/... and /v2/eats/... live here. */
  apiBaseUrl: string;
}

export const UBER_EATS_HOSTS: Record<UberEatsEnvironment, UberEatsHosts> = {
  sandbox: { environment: "sandbox", authBaseUrl: "https://sandbox-login.uber.com", apiBaseUrl: "https://test-api.uber.com" },
  production: { environment: "production", authBaseUrl: "https://auth.uber.com", apiBaseUrl: "https://api.uber.com" },
};

/** Production hosts only for a production deployment: a dev or test process configured with
 *  UBER_EATS_ENVIRONMENT=production is refused rather than allowed to make live Uber calls. */
export function resolveUberEatsHosts(environment: UberEatsEnvironment, nodeEnv: string): UberEatsHosts {
  if (environment === "production" && nodeEnv !== "production") {
    throw new Error("UBER_EATS_ENVIRONMENT=production is only allowed when NODE_ENV=production — use the sandbox for development and testing.");
  }
  return UBER_EATS_HOSTS[environment];
}
