type LogLevel = "debug" | "info" | "warn" | "error";

// Phase 48 — was an exact-match Set (only a key literally named e.g. "password" got redacted), so
// a compound field name like smtpPassword/stripeSecretKey/webhookSecret/clientSecret/apiKey would
// pass through unredacted even though it's exactly the class of value this exists to catch (SMTP
// passwords, Stripe/Safepay/Paddle secrets, webhook secrets — see docs/operations-monitoring.md's
// logging section). Substring matching on the same underlying words closes that gap without
// needing to enumerate every possible compound key name up front. Still deliberately narrow: only
// these specific words, never a blanket "redact anything that looks sensitive" heuristic that would
// make legitimate diagnostic fields (orderId, restaurantId, jobId, ...) unreadable.
const SENSITIVE_KEY_SUBSTRINGS = ["password", "token", "secret", "authorization", "cookie", "apikey"];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_SUBSTRINGS.some((s) => lower.includes(s));
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, isSensitiveKey(key) ? "[REDACTED]" : redact(val)])
    );
  }
  return value;
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ? (redact(meta) as Record<string, unknown>) : {}),
  };
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  out(JSON.stringify(line));
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
};
