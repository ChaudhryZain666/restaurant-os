# shellcheck shell=bash
# Shared helpers for the GarnishTable server scripts (Phase 87). Sourced, never executed.
#
# Server layout (docs/production-deployment-runbook.md):
#
#   /opt/garnishtable/                GT_ROOT
#     repo/                           git clone of the repository (deploy reads config from it)
#     config/edge.env                 hostnames, ACME e-mail, registry, profiles   (mode 600)
#     config/api.env                  API secrets: MONGO_URI, JWT_*, SMTP_*, …     (mode 600)
#     releases/sha-<commit>/          infrastructure/production exactly as committed at <commit>
#     state/current, state/previous   "<tag> <registry>" of the live / last-good deployment
#     state/history.log               one line per deploy, rollback and failure
#     backups/                        MongoDB dumps (backup.sh)
#
# Nothing here prints secret values: env files are read only for the specific non-secret keys named.

set -euo pipefail

GT_ROOT="${GT_ROOT:-/opt/garnishtable}"
GT_REPO="${GT_REPO:-$GT_ROOT/repo}"
GT_CONFIG="${GT_CONFIG:-$GT_ROOT/config}"
GT_EDGE_ENV="${GT_EDGE_ENV:-$GT_CONFIG/edge.env}"
GT_RELEASES="$GT_ROOT/releases"
GT_STATE="$GT_ROOT/state"
GT_PROJECT=garnishtable
GT_SERVICES=(api web admin marketing)
# TEST ONLY: extra compose files (absolute paths) layered on every release, e.g. the CI simulated
# server's Pebble/MongoDB overlay. Never set on a real server.
GT_COMPOSE_EXTRA_FILES="${GT_COMPOSE_EXTRA_FILES:-}"

log() { printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${GT_LOG_TAG:-gt}" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# Value of one NON-SECRET key from an env file (last assignment wins, surrounding quotes removed).
env_value() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "$file" | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# Image registry for the deployment: GT_IMAGE_REGISTRY from the environment, else edge.env.
registry() {
  local r="${GT_IMAGE_REGISTRY:-$(env_value "$GT_EDGE_ENV" GT_IMAGE_REGISTRY)}"
  [ -n "$r" ] || die "GT_IMAGE_REGISTRY is not set in $GT_EDGE_ENV (e.g. ghcr.io/<owner>/restaurant-os)"
  printf '%s' "$r"
}

# Immutable tags only: sha-<full 40-character commit>. "latest", branch names and short SHAs are refused.
valid_tag() { [[ "$1" =~ ^sha-[0-9a-f]{40}$ ]]; }
tag_commit() { printf '%s' "${1#sha-}"; }

# docker compose for one release: compose files from that release, interpolation from edge.env,
# image tag/registry pinned explicitly (shell environment beats --env-file).
gt_compose() {
  local tag="$1" reg="$2"; shift 2
  local dir="$GT_RELEASES/$tag" args=() profiles f
  args+=(--project-name "$GT_PROJECT" --env-file "$GT_EDGE_ENV" --project-directory "$dir" -f "$dir/docker-compose.yml")
  for f in $GT_COMPOSE_EXTRA_FILES; do args+=(-f "$f"); done
  profiles="$(env_value "$GT_EDGE_ENV" GT_COMPOSE_PROFILES)"
  for f in ${profiles//,/ }; do args+=(--profile "$f"); done
  GT_IMAGE_TAG="$tag" GT_IMAGE_REGISTRY="$reg" docker compose "${args[@]}" "$@"
}

state_get() { [ -f "$GT_STATE/$1" ] && cat "$GT_STATE/$1" || true; }
state_set() { mkdir -p "$GT_STATE"; printf '%s\n' "$2" > "$GT_STATE/$1.tmp" && mv "$GT_STATE/$1.tmp" "$GT_STATE/$1"; }
history() { mkdir -p "$GT_STATE"; printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$GT_STATE/history.log"; }

# Optional operator alert (ALERT_WEBHOOK_URL in edge.env: any endpoint accepting a JSON POST, e.g. a
# Slack/Discord/ntfy webhook). Never fails the caller.
alert() {
  local url; url="$(env_value "$GT_EDGE_ENV" ALERT_WEBHOOK_URL)"
  [ -n "$url" ] || return 0
  local msg="[garnishtable $(hostname)] $*"
  curl -fsS -m 10 -H 'Content-Type: application/json' \
    -d "$(printf '{"text":"%s","content":"%s"}' "${msg//\"/\'}" "${msg//\"/\'}")" "$url" > /dev/null 2>&1 || log "alert delivery failed"
}
