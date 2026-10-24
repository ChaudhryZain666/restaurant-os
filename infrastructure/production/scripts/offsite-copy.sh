#!/usr/bin/env bash
# GarnishTable off-site backup copy — the command for GT_BACKUP_OFFSITE_CMD (backup.sh appends the
# dump's path as the LAST argument, so `rclone copy …` cannot be used there directly: it would read
# the file as the destination).
#
#   GT_BACKUP_OFFSITE_CMD=/opt/garnishtable/repo/infrastructure/production/scripts/offsite-copy.sh <rclone-remote:path>
#   → offsite-copy.sh <rclone-remote:path> /opt/garnishtable/backups/mongo-<time>.archive.gz
#
# Runs rclone from its official image (nothing installed on the host), reading the remote's
# credentials from $GT_CONFIG/rclone.conf (mode 600, never in git). Copies one file, never deletes
# anything remote — retention there is the bucket's own lifecycle rule. Use an rclone "crypt"
# remote on top of the storage remote so the provider only ever stores encrypted dumps.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GT_LOG_TAG=offsite
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

RCLONE_IMAGE="${GT_RCLONE_IMAGE:-rclone/rclone:1.68.2}"
[ $# -eq 2 ] || die "usage: offsite-copy.sh <rclone-remote:path> <file> (the file is appended by backup.sh)"
remote="$1" file="$2"
case "$remote" in *:*) ;; *) die "the destination must be an rclone remote such as offsite:garnishtable-backups — got '$remote'" ;; esac
[ -f "$file" ] || die "no such file: $file"
conf="$GT_CONFIG/rclone.conf"
[ -f "$conf" ] || die "missing $conf (rclone remote credentials)"

docker run --rm --network bridge \
  -v "$conf:/config/rclone/rclone.conf:ro" \
  -v "$(dirname "$file"):/data:ro" \
  "$RCLONE_IMAGE" copyto --quiet "/data/$(basename "$file")" "${remote%/}/$(basename "$file")"
