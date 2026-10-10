#!/bin/sh
# Phase 88 — last line of defence after a production frontend build: refuses an image whose built
# files still contain a placeholder that must never be published (unfilled legal facts, internal
# legal-review markers). check-build-env.sh validates the inputs; this checks the actual output.
set -eu
dist="${1:?usage: check-build-output.sh <dist directory>}"
tokens='\[(LEGAL_ENTITY_NAME|GOVERNING_JURISDICTION|LEGAL_CONTACT_EMAIL|PRIVACY_CONTACT_EMAIL|BILLING_CONTACT_EMAIL)\]|FOUNDER/LEGAL REVIEW REQUIRED'
hits=$(grep -rlE "$tokens" "$dist" 2>/dev/null || true)
if [ -n "$hits" ]; then
  echo "Built output contains unpublishable placeholders:" >&2
  echo "$hits" | sed 's/^/  /' >&2
  exit 1
fi
echo "Build output OK: no placeholder tokens in $dist"
