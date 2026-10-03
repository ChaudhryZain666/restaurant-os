# syntax=docker/dockerfile:1
# Phase 85A — PRODUCTION image for the API (HTTP + Socket.IO + the in-process BullMQ worker and
# its repeatable jobs). Runs the compiled build — never tsx, never a watcher. One container = the
# one API instance the current architecture supports (docs/production-architecture.md).
#
#   docker build -f infrastructure/docker/api.prod.Dockerfile -t garnishtable-api .
#   docker run --env-file apps/api/.env.production -p 4000:4000 garnishtable-api
#
# Deploy steps run from the same image (cwd is apps/api):
#   docker run --rm --env-file ... garnishtable-api node dist/scripts/ensureIndexes.js
#   docker run --rm --env-file ... garnishtable-api node dist/scripts/seed.js
#   docker run --rm --env-file ... garnishtable-api node dist/scripts/bootstrapPlatformAdmin.js
#   docker run --rm --env-file ... garnishtable-api node dist/scripts/provisionProductionDemo.js
#
# Secrets are never baked in: .dockerignore excludes every .env file; pass them at run time.

FROM node:22-slim AS build
WORKDIR /repo
# Every workspace manifest, so `npm ci` can honour the root lockfile exactly.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY apps/marketing/package.json apps/marketing/
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/validation/package.json packages/validation/
COPY packages/utils/package.json packages/utils/
COPY packages/ui/package.json packages/ui/
RUN npm ci
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm run build -w packages/types \
 && npm run build -w packages/validation \
 && npm run build -w apps/api \
 && npm prune --omit=dev \
 && mkdir -p apps/api/node_modules packages/types/node_modules packages/validation/node_modules

FROM node:22-slim AS runtime
ENV NODE_ENV=production
# Phase 87 — which commit this image was built from (set by CI). Exposed read-only at
# GET /health(/live) as data.version; never secret. Declared late so it doesn't bust the build cache.
ARG GIT_SHA=unknown
ARG BUILD_TIME=
ENV GIT_SHA=${GIT_SHA} BUILD_TIME=${BUILD_TIME}
LABEL org.opencontainers.image.revision=${GIT_SHA}       org.opencontainers.image.created=${BUILD_TIME}       org.opencontainers.image.title="garnishtable-api"
WORKDIR /repo
COPY --from=build --chown=node:node /repo/package.json ./
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/packages/types/package.json packages/types/
COPY --from=build --chown=node:node /repo/packages/types/dist packages/types/dist
COPY --from=build --chown=node:node /repo/packages/types/node_modules packages/types/node_modules
COPY --from=build --chown=node:node /repo/packages/validation/package.json packages/validation/
COPY --from=build --chown=node:node /repo/packages/validation/dist packages/validation/dist
COPY --from=build --chown=node:node /repo/packages/validation/node_modules packages/validation/node_modules
COPY --from=build --chown=node:node /repo/apps/api/package.json apps/api/
COPY --from=build --chown=node:node /repo/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /repo/apps/api/node_modules apps/api/node_modules
# /api/docs (Swagger) reads ../../docs/openapi.yaml relative to apps/api (app.ts).
COPY --chown=node:node docs/openapi.yaml docs/openapi.yaml
USER node
WORKDIR /repo/apps/api
EXPOSE 4000
# Liveness only (process up). Readiness — Mongo + Redis reachable — is GET /health (503 when degraded).
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "require('http').get('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/live',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
# Node is PID 1 and handles SIGTERM/SIGINT itself (index.ts graceful shutdown: stop HTTP, close
# sockets, drain the BullMQ worker, close Mongo/Redis), bounded at 10s (shutdown.ts) — give the
# supervisor a stop timeout of at least 15s so it never SIGKILLs a clean shutdown.
STOPSIGNAL SIGTERM
CMD ["node", "dist/index.js"]
