#!/usr/bin/env bash
# GarnishTable rollback (Phase 87): put a previously deployed immutable image set back in service.
#
#   rollback.sh                 roll back to the last good deployment before the live one (state/previous)
#   rollback.sh sha-<commit>    roll back to that specific earlier deployment
#
# Uses the images already on this host when present (works even if the registry is unreachable),
# skips the index build (indexes are additive, so the newer ones are harmless to older code), and
# goes through the same health + smoke verification as a deploy. Database contents are NOT rolled
# back — see docs/incident-runbook.md for when a restore is also needed.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GT_LOG_TAG=rollback
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

if [ -n "${1:-}" ]; then
  valid_tag "$1" || die "usage: rollback.sh [sha-<40-char commit>]"
  # Same registry the tag was deployed from, if the history knows it.
  reg="$(grep -E " ok $1 " "$GT_STATE/history.log" 2> /dev/null | tail -1 | awk '{print $5}')"
  target="$1 ${reg:-$(registry)}"
else
  target="$(state_get previous)"
  [ -n "$target" ] || die "no previous deployment recorded in $GT_STATE/previous — name a tag explicitly"
fi
read -r tag reg <<< "$target"
log "rolling back from $(state_get current | cut -d' ' -f1) to $tag"
GT_DEPLOY_REASON=rollback GT_IMAGE_REGISTRY="$reg" exec "$SCRIPT_DIR/deploy.sh" "$tag" --pull-missing --skip-indexes --no-rollback
