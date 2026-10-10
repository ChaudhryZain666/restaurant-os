# syntax=docker/dockerfile:1
# Phase 85A — PRODUCTION image for one static frontend: the Vite production build, served by nginx
# with SPA fallback and the same-origin /api proxy every frontend depends on (all three apps call
# the API at the RELATIVE path /api/v1 — see docs/production-architecture.md).
#
#   APP=web        → customer storefront   (order.garnishtable.com, and customer custom domains)
#   APP=admin      → Owner Portal, Agency Portal, Platform Admin and POS — ONE build, served on
#                    app., agency., admin. and pos.garnishtable.com
#   APP=marketing  → marketing site        (garnishtable.com)
#
# VITE_* values are compiled into the bundle, so they're build arguments, e.g.
#   docker build -f infrastructure/docker/frontend.prod.Dockerfile --build-arg APP=web \
#     --build-arg VITE_API_URL=https://api.garnishtable.com \
#     --build-arg VITE_SITE_URL=https://order.garnishtable.com \
#     --build-arg VITE_ADMIN_URL=https://app.garnishtable.com \
#     --build-arg VITE_MARKETING_URL=https://garnishtable.com -t garnishtable-web .
# The build fails if a value the app needs is missing (check-build-env.sh) rather than shipping
# localhost fallbacks. At run time, API_UPSTREAM is where nginx forwards /api (default http://api:4000).

FROM node:22-slim AS build
ARG APP
WORKDIR /repo
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
COPY apps/${APP} ./apps/${APP}
COPY infrastructure/docker/check-build-env.sh /usr/local/bin/check-build-env.sh
COPY infrastructure/docker/check-build-output.sh /usr/local/bin/check-build-output.sh
ARG VITE_API_URL
ARG VITE_SITE_URL
ARG VITE_ADMIN_URL
ARG VITE_STOREFRONT_URL
ARG VITE_MARKETING_URL
ARG VITE_POS_URL
ARG VITE_AGENCY_URL
ARG VITE_PLATFORM_ADMIN_URL
ARG VITE_RESTAURANT_SLUG
# Phase 88 — marketing only: founder-supplied facts the legal pages state (apps/marketing/src/lib/legal.ts).
ARG VITE_LEGAL_ENTITY_NAME
ARG VITE_LEGAL_JURISDICTION
ARG VITE_LEGAL_CONTACT_EMAIL
ARG VITE_PRIVACY_CONTACT_EMAIL
ARG VITE_BILLING_CONTACT_EMAIL
RUN sh /usr/local/bin/check-build-env.sh "${APP}" \
 && npm run build:packages \
 && npm run build -w "apps/${APP}" \
 && sh /usr/local/bin/check-build-output.sh "apps/${APP}/dist" \
 && if [ "${APP}" = marketing ]; then \
      # Phase 89 — all five legal values or none get past check-build-env.sh, so one says which.
      if [ -n "${VITE_LEGAL_ENTITY_NAME}" ]; then echo true; else echo false; fi > "apps/${APP}/dist/.legal-configured"; \
    fi

FROM nginx:1.27-alpine AS runtime
ARG APP
ENV API_UPSTREAM=http://api:4000
# Who may frame this app (storefront only uses it; docker-compose.yml sets the real origins).
ENV FRAME_ANCESTORS="'self'"
COPY --from=build /repo/apps/${APP}/dist /usr/share/nginx/html
# Phase 87 — which commit this image was built from (set by CI): served at /version.json and
# recorded as an image label, so a deployment can be verified and traced to a Git commit.
ARG GIT_SHA=unknown
ARG BUILD_TIME=
# Phase 89 — marketing also reports legalConfigured, so "legal pages not published yet" stays a
# visible launch blocker (smoke-test.sh warns on false).
# Also writes legal-robots.inc (included by marketing.locations.template's legal-page location):
# "X-Robots-Tag: noindex, nofollow" only while the marketing legal values are unconfigured; a
# comment otherwise and for the other apps, so the include always exists.
RUN legal=""; marker=/usr/share/nginx/html/.legal-configured; robots="# legal pages configured (or not the marketing app)"; \
    if [ -f "$marker" ]; then \
      legal=",\"legalConfigured\":$(cat "$marker")"; \
      if [ "$(cat "$marker")" = false ]; then robots='add_header X-Robots-Tag "noindex, nofollow" always;'; fi; \
      rm -f "$marker"; \
    fi; \
    printf '%s\n' "$robots" > /etc/nginx/conf.d/legal-robots.inc; \
    printf '{"app":"%s","commit":"%s","builtAt":"%s"%s}' "${APP}" "${GIT_SHA}" "${BUILD_TIME}" "$legal" > /usr/share/nginx/html/version.json
LABEL org.opencontainers.image.revision=${GIT_SHA}       org.opencontainers.image.created=${BUILD_TIME}       org.opencontainers.image.title="garnishtable-${APP}"
COPY infrastructure/docker/nginx/frontend.conf.template /etc/nginx/templates/default.conf.template
COPY infrastructure/docker/nginx/${APP}.locations.template /etc/nginx/templates/app-locations.inc.template
# Phase 88 — per-app security headers (frame-ancestors, nosniff, Referrer-Policy).
COPY infrastructure/docker/nginx/${APP}.headers.template /etc/nginx/templates/app-headers.inc.template
EXPOSE 80
