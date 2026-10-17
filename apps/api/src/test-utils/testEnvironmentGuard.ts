/**
 * Phase 89 — what jest.setup.env.ts checks before any test runs: the test process must use its own
 * local database and the mock billing provider, with no Paddle credentials loaded. Tests write
 * fixtures freely and call billing code paths, so either of these pointing somewhere real would
 * pollute the dev database or send real requests to Paddle.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function testEnvironmentProblems(vars: Record<string, string | undefined>): string[] {
  const problems: string[] = [];

  if (vars.BILLING_PROVIDER !== "mock") {
    problems.push(`BILLING_PROVIDER is "${vars.BILLING_PROVIDER ?? "(unset)"}" — tests must use "mock"`);
  }
  for (const key of ["PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET", "PADDLE_CLIENT_TOKEN"]) {
    if (vars[key]) problems.push(`${key} is set — tests must not load Paddle credentials`);
  }

  const mongoUri = vars.MONGO_URI;
  if (!mongoUri) {
    problems.push("MONGO_URI is not set");
  } else {
    let url: URL | null = null;
    try {
      url = new URL(mongoUri);
    } catch {
      problems.push("MONGO_URI is not a valid URL");
    }
    if (url) {
      const hosts = url.host.split(",").map((h) => h.replace(/:\d+$/, ""));
      if (url.protocol !== "mongodb:" || !hosts.every((h) => LOCAL_HOSTS.has(h))) {
        problems.push("MONGO_URI must point at a local MongoDB (localhost) for tests");
      }
      const database = url.pathname.replace(/^\//, "");
      if (!database.endsWith("_test")) {
        problems.push(`MONGO_URI's database "${database || "(none)"}" must end in "_test"`);
      }
    }
  }

  return problems;
}

/**
 * Phase 89 — wraps fetch so a test can never reach a real external service (Paddle, Stripe, an AI
 * provider…) by accident: any request to a non-local host throws. Tests that fake fetch with
 * jest.spyOn(globalThis, "fetch") are unaffected — their fake answers first; only a call nothing
 * faked falls through to this guard.
 */
export function blockExternalFetch(target: { fetch: typeof fetch }): void {
  const realFetch = target.fetch;
  target.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!LOCAL_HOSTS.has(url.hostname)) {
      throw new Error(`Tests may not make real network requests (attempted ${url.origin}). Fake fetch in this test instead.`);
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

export function assertSafeTestEnvironment(vars: Record<string, string | undefined>): void {
  const problems = testEnvironmentProblems(vars);
  if (problems.length) {
    throw new Error(`Refusing to run tests in an unsafe environment:\n - ${problems.join("\n - ")}`);
  }
}
