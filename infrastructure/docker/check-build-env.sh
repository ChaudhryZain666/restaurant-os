#!/bin/sh
# Phase 85A — refuses a production frontend build that is missing a URL the app needs. Without
# this, an unset VITE_* silently falls back to a localhost dev URL compiled into the bundle.
set -eu
app="${1:?usage: check-build-env.sh <web|admin|marketing>}"
case "$app" in
  web)       required="VITE_API_URL VITE_SITE_URL VITE_ADMIN_URL VITE_MARKETING_URL" ;;
  admin)     required="VITE_API_URL VITE_STOREFRONT_URL VITE_MARKETING_URL VITE_POS_URL VITE_AGENCY_URL VITE_PLATFORM_ADMIN_URL" ;;
  marketing) required="VITE_SITE_URL VITE_STOREFRONT_URL VITE_ADMIN_URL" ;;
  *) echo "Unknown APP \"$app\" (expected web, admin or marketing)" >&2; exit 1 ;;
esac
missing=""
for name in $required; do
  value=$(printenv "$name" || true)
  case "$value" in
    "") missing="$missing $name" ;;
    *localhost*|*127.0.0.1*) echo "$name points at a local address ($value) — not a production build." >&2; exit 1 ;;
  esac
done
if [ -n "$missing" ]; then
  echo "Missing build arguments for APP=$app:$missing" >&2
  exit 1
fi
echo "Build environment OK for APP=$app"
