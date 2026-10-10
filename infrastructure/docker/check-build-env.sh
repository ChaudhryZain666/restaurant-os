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
# Phase 88/89 — the legal pages state founder-supplied facts (apps/marketing/src/lib/legal.ts).
# Option C: all five, or none. None → the build continues and the pages say "being finalized" (a
# loud warning; a launch blocker). Some but not all → refused. Provided values get the same
# placeholder/email checks as every other value below.
if [ "$app" = marketing ]; then
  legal="VITE_LEGAL_ENTITY_NAME VITE_LEGAL_JURISDICTION VITE_LEGAL_CONTACT_EMAIL VITE_PRIVACY_CONTACT_EMAIL VITE_BILLING_CONTACT_EMAIL"
  legal_set=0
  for name in $legal; do [ -z "$(printenv "$name" || true)" ] || legal_set=$((legal_set + 1)); done
  if [ "$legal_set" -eq 0 ]; then
    echo "WARNING: legal pages not configured — /terms, /privacy and /refund-policy will say \"Legal documents are being finalized\". Production-readiness blocker: provide all five VITE_LEGAL_* values before launching paid plans." >&2
  else
    required="$required $legal"
  fi
fi
missing=""
for name in $required; do
  value=$(printenv "$name" || true)
  case "$value" in
    "") missing="$missing $name" ;;
    *localhost*|*127.0.0.1*) echo "$name points at a local address ($value) — not a production build." >&2; exit 1 ;;
    *"["*|*"]"*|*.local|*example.com*|*example.org*|*changeme*|*CHANGEME*) echo "$name looks like a placeholder ($value) — refusing a production build." >&2; exit 1 ;;
  esac
  [ -n "$value" ] || continue
  case "$name" in
    *_EMAIL) printf '%s' "$value" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' || { echo "$name is not an email address ($value)." >&2; exit 1; } ;;
  esac
done
if [ -n "$missing" ]; then
  echo "Missing build arguments for APP=$app:$missing" >&2
  exit 1
fi
echo "Build environment OK for APP=$app"
