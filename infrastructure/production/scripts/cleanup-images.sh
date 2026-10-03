#!/usr/bin/env bash
# GarnishTable image cleanup (Phase 87). Run weekly by garnishtable-cleanup.timer.
#
# Deletes GarnishTable images of old deployments, KEEPING the live one, the rollback target
# (state/previous) and the newest GT_KEEP_RELEASES (default 3) deployed tags — so a rollback never
# needs the registry. Then removes dangling layers and stopped one-off containers. Never touches
# volumes (certificates, Redis data) or images in use.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GT_LOG_TAG=cleanup
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

reg="$(registry)"
[ -n "$(state_get current)" ] || die "no live deployment is recorded in $GT_STATE/current — refusing to guess which images to keep"
keep_n="${GT_KEEP_RELEASES:-3}"
keep="$(state_get current | cut -d' ' -f1) $(state_get previous | cut -d' ' -f1) \
  $(awk '$3 == "ok" {print $4}' "$GT_STATE/history.log" 2> /dev/null | tac | awk '!seen[$0]++' | head -n "$keep_n" | tr '\n' ' ')"
log "keeping: $(echo $keep | tr ' ' '\n' | sort -u | tr '\n' ' ')"

removed=0
for svc in "${GT_SERVICES[@]}"; do
  for ref in $(docker image ls "$reg/$svc" --format '{{.Repository}}:{{.Tag}}' | grep -v ':<none>$'); do
    tag="${ref##*:}"
    case " $keep " in *" $tag "*) continue ;; esac
    docker image rm "$ref" > /dev/null 2>&1 && removed=$((removed + 1))
  done
done
docker container prune -f --filter "label=com.docker.compose.project=$GT_PROJECT" > /dev/null
docker image prune -f > /dev/null
log "removed $removed old image tags; disk now $(df -h /var/lib/docker | awk 'NR==2 {print $5" used, "$4" free"}')"
