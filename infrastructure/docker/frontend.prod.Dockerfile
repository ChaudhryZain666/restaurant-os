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
ARG VITE_API_URL
ARG VITE_SITE_URL
ARG VITE_ADMIN_URL
ARG VITE_STOREFRONT_URL
ARG VITE_MARKETING_URL
ARG VITE_POS_URL
ARG VITE_AGENCY_URL
ARG VITE_PLATFORM_ADMIN_URL
ARG VITE_RESTAURANT_SLUG
RUN sh /usr/local/bin/check-build-env.sh "${APP}" \
 && npm run build:packages \
 && npm run build -w "apps/${APP}"

FROM nginx:1.27-alpine AS runtime
ARG APP
ENV API_UPSTREAM=http://api:4000
COPY --from=build /repo/apps/${APP}/dist /usr/share/nginx/html
COPY infrastructure/docker/nginx/frontend.conf.template /etc/nginx/templates/default.conf.template
COPY infrastructure/docker/nginx/${APP}.locations.template /etc/nginx/templates/app-locations.inc.template
EXPOSE 80
