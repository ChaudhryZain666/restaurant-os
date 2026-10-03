#!/usr/bin/env bash
# GarnishTable backup (Phase 87): MongoDB dump + Caddy certificate store, kept on this server.
#
#   backup.sh            → backups/mongo-<UTC time>.archive.gz and backups/caddy-<UTC time>.tar.gz
#
# The API image deliberately has no MongoDB tools, so the dump runs in the official mongo:7 image
# (mongodump). MONGO_URI is read from the API env file into a temporary mode-600 file and never
# printed. Dumps older than GT_BACKUP_KEEP_DAYS (default 14) are deleted.
#
# A copy that only lives on this server is not a backup of this server: set GT_BACKUP_OFFSITE_CMD in
# edge.env to a command that ships the file elsewhere (it is run with the file path appended), e.g.
#   GT_BACKUP_OFFSITE_CMD=rclone copy --quiet --config /opt/garnishtable/config/rclone.conf
# and keep Atlas's own backups enabled on a paid tier (see the runbook).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GT_LOG_TAG=backup
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

BACKUPS="${GT_BACKUPS:-$GT_ROOT/backups}"
KEEP="${GT_BACKUP_KEEP_DAYS:-$(env_value "$GT_EDGE_ENV" GT_BACKUP_KEEP_DAYS)}"; KEEP="${KEEP:-14}"
NETWORK="${GT_BACKUP_NETWORK:-bridge}"   # TEST ONLY: the CI simulated server's private MongoDB network
MONGO_IMAGE="${GT_MONGO_TOOLS_IMAGE:-mongo:7}"
api_env="$(env_value "$GT_EDGE_ENV" GT_API_ENV_FILE)"
[ -f "$api_env" ] || die "API env file not found (GT_API_ENV_FILE in $GT_EDGE_ENV)"

umask 077
mkdir -p "$BACKUPS"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
secret_env="$(mktemp)"; trap 'rm -f "$secret_env"' EXIT
uri="$(env_value "$api_env" MONGO_URI)"
[ -n "$uri" ] || die "MONGO_URI is not set in the API env file"
printf 'MONGO_URI=%s\n' "$uri" > "$secret_env"; unset uri

out="$BACKUPS/mongo-$stamp.archive.gz"
log "dumping MongoDB → $out"
if ! docker run --rm --network "$NETWORK" --env-file "$secret_env" "$MONGO_IMAGE" \
    sh -c 'exec mongodump --uri="$MONGO_URI" --archive --gzip --quiet' > "$out.partial"; then
  rm -f "$out.partial"; alert "MongoDB backup FAILED"; die "mongodump failed"
fi
gzip -t "$out.partial" 2> /dev/null || { rm -f "$out.partial"; alert "MongoDB backup FAILED (corrupt archive)"; die "dump archive is not valid gzip"; }
mv "$out.partial" "$out"
log "MongoDB dump OK ($(du -h "$out" | cut -f1))"

caddy_out="$BACKUPS/caddy-$stamp.tar.gz"
if docker volume inspect "${GT_PROJECT}_caddy_data" > /dev/null 2>&1; then
  docker run --rm -v "${GT_PROJECT}_caddy_data:/data:ro" "$MONGO_IMAGE" tar -czf - -C /data . > "$caddy_out" \
    && log "Caddy certificate store OK ($(du -h "$caddy_out" | cut -f1))" \
    || { rm -f "$caddy_out"; log "WARNING: Caddy certificate store backup failed"; }
fi

offsite="$(env_value "$GT_EDGE_ENV" GT_BACKUP_OFFSITE_CMD)"
if [ -n "$offsite" ]; then
  # shellcheck disable=SC2086 # the configured command is deliberately word-split
  $offsite "$out" && log "off-site copy OK" || { alert "off-site backup copy FAILED"; log "WARNING: off-site copy failed"; }
else
  log "NOTE: no GT_BACKUP_OFFSITE_CMD configured — this dump exists only on this server"
fi

find "$BACKUPS" -maxdepth 1 -type f \( -name 'mongo-*.archive.gz' -o -name 'caddy-*.tar.gz' \) -mtime +"$KEEP" -print -delete | sed 's/^/pruned /' >&2
history "backup ok $(basename "$out")"
echo "$out"
