#!/usr/bin/env bash
# Phase 89 (legal option C) — builds the marketing site twice and checks what the legal pages would
# publish: without the legal values → the "being finalized" notice and no placeholder tokens; with
# (test) values → the real document text, no notice. Needs the workspace packages built first
# (npm run build:packages). Run: bash infrastructure/production/test/marketing-legal-build-test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DIST="$ROOT/apps/marketing/dist"
NOTICE="Legal documents are being finalized"
TOKENS='\[(LEGAL_ENTITY_NAME|GOVERNING_JURISDICTION|LEGAL_CONTACT_EMAIL|PRIVACY_CONTACT_EMAIL|BILLING_CONTACT_EMAIL)\]|FOUNDER/LEGAL REVIEW REQUIRED'
failures=0
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; failures=$((failures + 1)); }
CHUNKS=()
load_chunks() { CHUNKS=(); local f; for f in "$DIST"/assets/TermsPage-*.js "$DIST"/assets/PrivacyPage-*.js "$DIST"/assets/RefundPolicyPage-*.js "$DIST"/assets/Legal*-*.js "$DIST"/assets/legal-*.js; do [ -f "$f" ] && CHUNKS+=("$f"); done; return 0; }

build() {  # build <log> [VAR=value …]
  local log="$1"; shift
  (cd "$ROOT" && env -u VITE_LEGAL_ENTITY_NAME -u VITE_LEGAL_JURISDICTION -u VITE_LEGAL_CONTACT_EMAIL \
    -u VITE_PRIVACY_CONTACT_EMAIL -u VITE_BILLING_CONTACT_EMAIL \
    VITE_SITE_URL=https://garnishtable.com VITE_STOREFRONT_URL=https://order.garnishtable.com VITE_ADMIN_URL=https://app.garnishtable.com \
    "$@" npm run build -w apps/marketing > "$log" 2>&1)
}
LOG="$(mktemp)"; trap 'rm -f "$LOG"' EXIT

# 1. No legal values: builds, warns, ships the notice and no placeholders.
if build "$LOG"; then
  grep -q "LEGAL PAGES NOT CONFIGURED" "$LOG" && pass "unconfigured: build warns it is a production-readiness blocker" || fail "unconfigured: no warning in the build log"
  load_chunks
  [ "${#CHUNKS[@]}" -ge 4 ] || fail "unconfigured: legal page chunks not found"
  if grep -q "$NOTICE" "${CHUNKS[@]}"; then pass "unconfigured: the 'being finalized' notice is in the bundle"; else fail "unconfigured: notice text missing"; fi
  if grep -qE "$TOKENS" "${CHUNKS[@]}"; then fail "unconfigured: placeholder tokens in the legal chunks"; else pass "unconfigured: no placeholder tokens"; fi
  if grep -qE "/(terms|privacy|refund-policy)</loc>" "$DIST/sitemap.xml"; then fail "unconfigured: legal pages still in sitemap.xml"; else pass "unconfigured: legal pages left out of sitemap.xml"; fi
  grep -q "/pricing</loc>" "$DIST/sitemap.xml" && pass "unconfigured: the rest of the sitemap is intact" || fail "unconfigured: other sitemap entries missing"
else
  fail "unconfigured: the build failed ($(tail -5 "$LOG"))"
fi

# 2. A partial set still fails the build.
if build "$LOG" VITE_LEGAL_ENTITY_NAME="Test Entity Ltd"; then fail "partial: the build should have been refused"; else
  grep -q "legal values are incomplete or invalid" "$LOG" && pass "partial: build refused" || fail "partial: refused for an unexpected reason ($(tail -3 "$LOG"))"
fi

# 3. All five (test) values: the document is built with them.
if build "$LOG" VITE_LEGAL_ENTITY_NAME="Phase89 Test Entity Ltd" VITE_LEGAL_JURISDICTION=Testland \
  VITE_LEGAL_CONTACT_EMAIL=legal@garnishtable.com VITE_PRIVACY_CONTACT_EMAIL=privacy@garnishtable.com VITE_BILLING_CONTACT_EMAIL=billing@garnishtable.com; then
  grep -q "LEGAL PAGES NOT CONFIGURED" "$LOG" && fail "configured: still warned as unconfigured" || pass "configured: no unconfigured warning"
  load_chunks
  grep -q "Phase89 Test Entity Ltd" "${CHUNKS[@]}" && pass "configured: entity name is in the bundle" || fail "configured: entity name missing"
  [ "$(grep -cE "/(terms|privacy|refund-policy)</loc>" "$DIST/sitemap.xml")" -eq 3 ] && pass "configured: all three legal pages are in sitemap.xml" || fail "configured: legal pages missing from sitemap.xml"
else
  fail "configured: the build failed ($(tail -5 "$LOG"))"
fi

if [ "$failures" -gt 0 ]; then echo "$failures marketing legal build test(s) failed"; exit 1; fi
echo "All marketing legal build tests passed"
