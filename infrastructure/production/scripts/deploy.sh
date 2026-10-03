#!/usr/bin/env bash
# GarnishTable deployment (Phase 87). Deploys one immutable, CI-built image set to this server.
#
#   deploy.sh sha-<40-char commit> [--init] [--no-pull | --pull-missing] [--skip-indexes] [--no-rollback]
#
#   1. refuses anything but an immutable sha-<commit> tag (never "latest")
#   2. takes the compose file + Caddyfile from that same commit (releases/sha-<commit>/), so the
#      configuration always matches the images
#   3. pulls the exact images from the registry and checks each one was built from <commit>
#   4. runs the additive index build (ensureIndexes); with --init also the idempotent first-deploy
#      steps (plan catalog seed, marketing demo storefront). Nothing destructive ever runs here.
#   5. starts the stack, waits for every health check, then runs smoke-test.sh against it
#   6. success → records the deployment; failure → rolls back to the version that was live before
#
# Exit codes: 0 deployed and healthy · 1 failed (and no healthy rollback) · 2 failed, rolled back OK.
# Images are never built here. See docs/production-deployment-runbook.md.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GT_LOG_TAG=deploy
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

TAG="${1:-}"; shift || true
PULL=always INIT=0 SKIP_INDEXES=0 ROLLBACK=1
while [ $# -gt 0 ]; do
  case "$1" in
    --init) INIT=1 ;;
    --no-pull) PULL=never ;;
    --pull-missing) PULL=missing ;;
    --skip-indexes) SKIP_INDEXES=1 ;;
    --no-rollback) ROLLBACK=0 ;;
    *) die "unknown option $1" ;;
  esac
  shift
done
valid_tag "$TAG" || die "usage: deploy.sh sha-<40-char commit> [options] — got '${TAG}'. Only immutable commit tags are deployable."
REASON="${GT_DEPLOY_REASON:-deploy}"

command -v docker > /dev/null || die "docker is not installed"
docker compose version > /dev/null 2>&1 || die "the docker compose plugin is not installed"
[ -f "$GT_EDGE_ENV" ] || die "missing $GT_EDGE_ENV (copy infrastructure/production/.env.example)"
api_env="$(env_value "$GT_EDGE_ENV" GT_API_ENV_FILE)"
[ -n "$api_env" ] && [ -f "$api_env" ] || die "GT_API_ENV_FILE in $GT_EDGE_ENV must name the API env file (e.g. $GT_CONFIG/api.env)"
for f in "$GT_EDGE_ENV" "$api_env"; do
  perms="$(stat -c %a "$f")"
  [ "${perms: -1}" = "0" ] && [ "${perms: -2:1}" = "0" ] || log "WARNING: $f is mode $perms; it holds secrets — chmod 600 it"
done

mkdir -p "$GT_RELEASES" "$GT_STATE"
exec 9> "$GT_STATE/deploy.lock"
flock -n 9 || die "another deployment is in progress"

# --- Release configuration from the same commit as the images ---------------------------------------
prepare_release() {
  local tag="$1" commit dir tmp
  commit="$(tag_commit "$tag")"; dir="$GT_RELEASES/$tag"
  [ -f "$dir/docker-compose.yml" ] && return 0
  [ -d "$GT_REPO/.git" ] || [ -f "$GT_REPO/HEAD" ] || die "no git checkout at $GT_REPO"
  if ! git -C "$GT_REPO" cat-file -e "$commit^{commit}" 2> /dev/null; then
    log "fetching commit $commit"
    git -C "$GT_REPO" fetch --quiet origin "$commit" 2> /dev/null || git -C "$GT_REPO" fetch --quiet origin || true
  fi
  git -C "$GT_REPO" cat-file -e "$commit^{commit}" 2> /dev/null || die "commit $commit is not in $GT_REPO (pushed?)"
  tmp="$(mktemp -d "$GT_RELEASES/.incoming.XXXXXX")"
  git -C "$GT_REPO" archive "$commit" infrastructure/production | tar -x -C "$tmp" --strip-components=2
  [ -f "$tmp/docker-compose.yml" ] || { rm -rf "$tmp"; die "commit $commit has no infrastructure/production/docker-compose.yml"; }
  mv "$tmp" "$dir"
}

image_ref() { printf '%s/%s:%s' "$2" "$3" "$1"; }  # tag registry service

ensure_images() {
  local tag="$1" reg="$2" mode="$3" svc ref commit rev
  commit="$(tag_commit "$tag")"
  case "$mode" in
    always) log "pulling images for $tag"; gt_compose "$tag" "$reg" pull --quiet || return 1 ;;
    missing)
      for svc in "${GT_SERVICES[@]}"; do
        ref="$(image_ref "$tag" "$reg" "$svc")"
        docker image inspect "$ref" > /dev/null 2>&1 || docker pull --quiet "$ref" > /dev/null || return 1
      done ;;
  esac
  for svc in "${GT_SERVICES[@]}"; do
    ref="$(image_ref "$tag" "$reg" "$svc")"
    rev="$(docker image inspect "$ref" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2> /dev/null)" \
      || { log "image $ref is not available"; return 1; }
    [ "$rev" = "$commit" ] || { log "image $ref was built from '${rev:-unknown}', not $commit"; return 1; }
  done
}

digests() {
  local tag="$1" reg="$2" svc out=""
  for svc in "${GT_SERVICES[@]}"; do
    out+=" $svc=$(docker image inspect "$(image_ref "$tag" "$reg" "$svc")" --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' 2> /dev/null | sed 's/.*@//' | cut -c1-19)"
  done
  printf '%s' "$out"
}

run_api_task() {  # one-off command in a fresh container of the NEW api image (old stack keeps serving)
  local tag="$1" reg="$2"; shift 2
  gt_compose "$tag" "$reg" run --rm -T --name "garnishtable-task-$$" api "$@"
}

# Bring one image set up and prove it healthy. Returns non-zero on any failure.
activate() {
  local tag="$1" reg="$2" mode="$3" skip_indexes="$4" init="$5"
  prepare_release "$tag" || return 1
  ensure_images "$tag" "$reg" "$mode" || return 1
  if [ "$skip_indexes" = 0 ]; then
    log "building MongoDB indexes (additive)"
    run_api_task "$tag" "$reg" node dist/scripts/ensureIndexes.js || { log "ensureIndexes failed"; return 1; }
  fi
  if [ "$init" = 1 ]; then
    log "first-deploy initialisation: plan catalog + marketing demo storefront (idempotent)"
    run_api_task "$tag" "$reg" node dist/scripts/seed.js || return 1
    run_api_task "$tag" "$reg" node dist/scripts/provisionProductionDemo.js || return 1
  fi
  log "starting $tag"
  gt_compose "$tag" "$reg" up -d --no-build --remove-orphans --wait --wait-timeout "${GT_WAIT_TIMEOUT:-300}" || { log "services did not become healthy"; return 1; }
  log "running smoke test"
  GT_SMOKE_QUIET="${GT_SMOKE_QUIET:-0}" "$SCRIPT_DIR/smoke-test.sh" --expect "$(tag_commit "$tag")" || { log "smoke test failed"; return 1; }
}

diagnostics() {
  local tag="$1" reg="$2" file
  file="$GT_STATE/failed-$tag-$(date -u +%Y%m%dT%H%M%SZ).log"
  { gt_compose "$tag" "$reg" ps -a; gt_compose "$tag" "$reg" logs --no-color --tail 120 api caddy; } > "$file" 2>&1 || true
  chmod 600 "$file"
  log "diagnostics saved to $file"
}

prune_releases() {  # keep the newest 6 release directories, never the live or rollback one
  local keep cur prev d
  cur="$(state_get current | cut -d' ' -f1)"; prev="$(state_get previous | cut -d' ' -f1)"
  keep=0
  for d in $(ls -1t "$GT_RELEASES" 2> /dev/null); do
    keep=$((keep + 1))
    [ "$keep" -le 6 ] || [ "$d" = "$cur" ] || [ "$d" = "$prev" ] || rm -rf "${GT_RELEASES:?}/$d"
  done
}

REG="$(registry)"
BEFORE="$(state_get current)"
log "$REASON $TAG from $REG (live before: ${BEFORE:-nothing})"
started=$(date +%s)

if activate "$TAG" "$REG" "$PULL" "$SKIP_INDEXES" "$INIT"; then
  if [ "$BEFORE" != "$TAG $REG" ]; then
    [ -n "$BEFORE" ] && state_set previous "$BEFORE"
    state_set current "$TAG $REG"
  fi
  history "$REASON ok $TAG $REG$(digests "$TAG" "$REG") ($(( $(date +%s) - started ))s)"
  prune_releases
  log "DEPLOY OK: $TAG is live and healthy ($(( $(date +%s) - started ))s)"
  exit 0
fi

diagnostics "$TAG" "$REG"
history "$REASON FAILED $TAG $REG"
alert "deployment of $TAG FAILED on $(hostname)"

# Roll back to what was live before this attempt (or, if this was a redeploy of the live tag, to
# the previous good one). Rollback images are already on the host, so it works with no registry.
TARGET="$BEFORE"
[ "$BEFORE" = "$TAG $REG" ] && TARGET="$(state_get previous)"
if [ "$ROLLBACK" = 0 ] || [ -z "$TARGET" ]; then
  log "DEPLOY FAILED: $TAG is not healthy and there is nothing to roll back to (or --no-rollback)"
  exit 1
fi
read -r RB_TAG RB_REG <<< "$TARGET"
log "rolling back to $RB_TAG"
if activate "$RB_TAG" "$RB_REG" missing 1 0; then
  state_set current "$RB_TAG $RB_REG"
  history "auto-rollback ok $RB_TAG $RB_REG (after failed $TAG)"
  alert "deployment of $TAG failed; rolled back to $RB_TAG, which is healthy"
  log "DEPLOY FAILED: $TAG was not healthy; ROLLED BACK to $RB_TAG, which is live and healthy"
  exit 2
fi
history "auto-rollback FAILED $RB_TAG $RB_REG (after failed $TAG)"
alert "deployment of $TAG failed AND rollback to $RB_TAG failed — site may be down"
log "DEPLOY FAILED and ROLLBACK FAILED — follow docs/incident-runbook.md"
exit 1
