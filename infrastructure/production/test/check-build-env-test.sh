#!/usr/bin/env bash
# Phase 89 (legal option C) — check-build-env.sh for APP=marketing: all five legal values or none.
# Run: bash infrastructure/production/test/check-build-env-test.sh
set -uo pipefail

CHECK="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../docker" && pwd)/check-build-env.sh"
failures=0

# Runs the check with only the given variables set (on top of the marketing URLs); prints the exit
# status and keeps stderr for the assertions.
run() {
  env -i PATH="$PATH" \
    VITE_SITE_URL=https://garnishtable.com VITE_STOREFRONT_URL=https://order.garnishtable.com VITE_ADMIN_URL=https://app.garnishtable.com \
    "$@" sh "$CHECK" marketing > /dev/null 2> "$ERR"
}
ERR="$(mktemp)"; trap 'rm -f "$ERR"' EXIT
expect() {
  local want="$1" pattern="$2" label="$3"; shift 3
  run "$@"; local got=$?
  if [ "$got" -eq "$want" ] && { [ -z "$pattern" ] || grep -q "$pattern" "$ERR"; }; then echo "PASS $label"; else echo "FAIL $label (exit $got: $(cat "$ERR"))"; failures=$((failures + 1)); fi
}

VALID=(VITE_LEGAL_ENTITY_NAME="Test Entity Ltd" VITE_LEGAL_JURISDICTION=Testland VITE_LEGAL_CONTACT_EMAIL=legal@garnishtable.com
  VITE_PRIVACY_CONTACT_EMAIL=privacy@garnishtable.com VITE_BILLING_CONTACT_EMAIL=billing@garnishtable.com)

expect 0 "legal pages not configured" "none set: builds, with the production-readiness warning"
expect 0 "" "all five valid: builds" "${VALID[@]}"
expect 1 "VITE_PRIVACY_CONTACT_EMAIL" "partial: refused, naming what is missing" VITE_LEGAL_ENTITY_NAME="Test Entity Ltd" VITE_LEGAL_JURISDICTION=Testland VITE_LEGAL_CONTACT_EMAIL=legal@garnishtable.com
expect 1 "placeholder" "placeholder value: refused" "${VALID[@]}" VITE_LEGAL_ENTITY_NAME="[LEGAL_ENTITY_NAME]"
expect 1 "not an email" "malformed email: refused" "${VALID[@]}" VITE_BILLING_CONTACT_EMAIL=billing-at-garnishtable
expect 1 "Missing build arguments" "a missing site URL is still refused" VITE_SITE_URL=

if [ "$failures" -gt 0 ]; then echo "$failures check-build-env test(s) failed"; exit 1; fi
echo "All check-build-env tests passed"
