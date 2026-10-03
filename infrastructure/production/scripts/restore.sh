#!/usr/bin/env bash
# GarnishTable restore (Phase 87): restore a backup.sh MongoDB dump.
#
#   restore.sh <mongo-….archive.gz> --to-db <name>       restore into a SEPARATE database (safe: use
#                                                          it to verify a backup, or to recover
#                                                          individual documents by hand)
#   restore.sh <mongo-….archive.gz> --replace-production  drop and replace the live database's
#                                                          collections with the dump (destructive)
#
# Runs mongorestore from the official mongo:7 image against MONGO_URI from the API env file (never
# printed). For --replace-production, stop the API first (docs/incident-runbook.md) so nothing
# writes during the restore, and take a fresh backup.sh of the current state before you start.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GT_LOG_TAG=restore
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

ARCHIVE="${1:-}"; MODE="${2:-}"; TO_DB="${3:-}"
[ -f "$ARCHIVE" ] || die "usage: restore.sh <archive> --to-db <name> | --replace-production"
NETWORK="${GT_BACKUP_NETWORK:-bridge}"
MONGO_IMAGE="${GT_MONGO_TOOLS_IMAGE:-mongo:7}"
api_env="$(env_value "$GT_EDGE_ENV" GT_API_ENV_FILE)"
uri="$(env_value "$api_env" MONGO_URI)"
[ -n "$uri" ] || die "MONGO_URI is not set in the API env file"
# Database named in the URI path (mongodb[+srv]://…/<db>?…); the driver default is "test".
src_db="$(sed -E 's#^mongodb(\+srv)?://[^/]*/?([^?]*).*#\2#' <<< "$uri")"; src_db="${src_db:-test}"

umask 077
secret_env="$(mktemp)"; trap 'rm -f "$secret_env"' EXIT
# mongorestore takes the target namespaces from --nsInclude/--nsTo, so the URI must not name a
# database (it would be treated as --db). Credentials and options are kept.
printf 'MONGO_URI=%s\n' "$(sed -E 's#^(mongodb(\+srv)?://[^/?]*)/[^?]*#\1/#' <<< "$uri")" > "$secret_env"; unset uri

case "$MODE" in
  --to-db)
    [[ "$TO_DB" =~ ^[A-Za-z0-9_-]+$ ]] || die "--to-db needs a database name"
    [ "$TO_DB" != "$src_db" ] || die "--to-db must differ from the live database ($src_db); use --replace-production to overwrite it"
    log "restoring $(basename "$ARCHIVE") into database '$TO_DB' (live database '$src_db' untouched)"
    args="--nsFrom=$src_db.* --nsTo=$TO_DB.* --drop" ;;
  --replace-production)
    if [ "${GT_RESTORE_CONFIRM:-}" != "replace $src_db" ]; then
      die "this DROPS and replaces every collection in '$src_db'. Re-run with GT_RESTORE_CONFIRM='replace $src_db'"
    fi
    log "REPLACING database '$src_db' with $(basename "$ARCHIVE")"
    args="--nsInclude=$src_db.* --drop" ;;
  *) die "choose --to-db <name> or --replace-production" ;;
esac

docker run --rm -i --network "$NETWORK" --env-file "$secret_env" -e RESTORE_ARGS="$args" "$MONGO_IMAGE" \
  sh -c 'exec mongorestore --uri="$MONGO_URI" --archive --gzip $RESTORE_ARGS' < "$ARCHIVE" \
  || die "mongorestore failed"
history "restore ok $(basename "$ARCHIVE") $MODE $TO_DB"
log "restore complete"
