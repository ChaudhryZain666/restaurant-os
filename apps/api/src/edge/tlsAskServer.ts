import express, { type NextFunction, type Request, type Response } from "express";
import { logger } from "../common/logger.js";
import { resolveCustomDomain, type CustomDomainDecision } from "../services/customDomain.service.js";

/**
 * Phase 86 — the certificate-issuance check for the TLS edge (Caddy `on_demand_tls { ask … }`,
 * infrastructure/production/Caddyfile). Before Caddy obtains or renews a certificate for a
 * restaurant's custom domain, it calls `GET /internal/tls/ask?domain=<hostname>`; any 2xx allows
 * it, anything else refuses it.
 *
 * Threat model (docs/custom-domains-operations.md):
 *  - Served on its OWN port (CUSTOM_DOMAIN_TLS_ASK_PORT), separate from the public API app. The
 *    production Compose stack never publishes that port and the Caddyfile never routes to it, so
 *    only containers on the private Docker network can reach it. Caddy's `ask` cannot send
 *    credentials, which is why isolation is by network rather than by a token.
 *  - Read-only: one decision function (customDomain.service.ts, the same one the storefront's
 *    by-domain lookup uses), no writes, no activation, no registration.
 *  - Minimal response: a bare `ok` / `denied` — no tenant, restaurant or reason in the body.
 *  - Fails closed: an unexpected error (e.g. MongoDB unavailable) answers 503, which Caddy
 *    treats as "do not issue".
 */
type Decide = (domain: unknown) => Promise<CustomDomainDecision>;

export function createTlsAskApp(decide: Decide = resolveCustomDomain) {
  const app = express();
  app.disable("x-powered-by");

  app.get("/internal/tls/ask", (req: Request, res: Response, next: NextFunction) => {
    decide(req.query.domain)
      .then((decision) => {
        if (decision.live) {
          logger.info("[tls-ask] certificate allowed", { hostname: decision.hostname });
          res.status(200).type("text/plain").send("ok");
        } else {
          // The hostname is attacker-controllable; log it only once it has passed validation.
          logger.warn("[tls-ask] certificate denied", { hostname: decision.hostname ?? "(malformed)", reason: decision.reason });
          res.status(403).type("text/plain").send("denied");
        }
      })
      .catch(next);
  });

  // Liveness of this listener itself (used by the Compose healthcheck), separate from /health.
  app.get("/internal/tls/health", (_req: Request, res: Response) => {
    res.status(200).type("text/plain").send("ok");
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).type("text/plain").send("not found");
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("[tls-ask] decision failed — refusing certificate", { error: err.message });
    res.status(503).type("text/plain").send("unavailable");
  });

  return app;
}
