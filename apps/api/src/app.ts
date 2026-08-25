import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import { env } from "./config/env.js";
import { requestId } from "./common/requestId.js";
import { requestLogger } from "./common/requestLogger.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { jsonRateLimitHandler } from "./middleware/rateLimitHandler.js";
import { healthRouter } from "./routes/health.routes.js";
import { sitemapRouter } from "./routes/sitemap.routes.js";
import { apiRouter } from "./routes/index.js";

const API_VERSION_PREFIX = "/api/v1";

function loadOpenApiDocument(): object {
  // Resolved from process.cwd() rather than import.meta.url: npm workspace scripts (dev, build,
  // start, test) all run with cwd set to apps/api, so this is stable across ts-node/tsx, the
  // compiled dist/ build, and Jest — import.meta.url isn't reliably usable under Jest's ESM mode.
  const path = resolve(process.cwd(), "../../docs/openapi.yaml");
  return YAML.parse(readFileSync(path, "utf-8"));
}

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: [env.CLIENT_ORIGIN, env.ADMIN_ORIGIN, env.MARKETING_ORIGIN], credentials: true }));
  // Captures the raw pre-parse body bytes onto req.rawBody — payment webhook signature
  // verification (controllers/paymentWebhook.controller.ts) must check the exact bytes a
  // provider signed; a re-serialized copy of the parsed JSON can differ in whitespace/key order
  // and would make every real signature fail. Applied globally (cheap) rather than only on the
  // webhook route, since express.json() itself is already global and this only adds a buffer
  // reference to the request, not a second parse pass.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  app.use(cookieParser());
  app.use(requestId);
  app.use(requestLogger);

  // Foundation-level rate limit; per-route limits (e.g. tighter on /auth/login) come later.
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 1000,
      standardHeaders: true,
      legacyHeaders: false,
      handler: jsonRateLimitHandler,
    })
  );

  app.use("/health", healthRouter);
  app.use("/sitemap.xml", sitemapRouter);

  try {
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(loadOpenApiDocument()));
  } catch (err) {
    console.error("[swagger] failed to load docs/openapi.yaml", err);
  }

  app.use(API_VERSION_PREFIX, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
