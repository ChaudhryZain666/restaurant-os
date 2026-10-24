#!/usr/bin/env bash
# offsite-copy.sh: the dump backup.sh appends must become rclone's SOURCE and the remote its
# destination (a bare `rclone copy` in GT_BACKUP_OFFSITE_CMD got this backwards). A fake `docker`
# on PATH records the call; nothing leaves the machine.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/../scripts/offsite-copy.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/root/config" "$tmp/root/backups"
cat > "$tmp/bin/docker" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$FAKE_DOCKER_LOG"
FAKE
chmod +x "$tmp/bin/docker"
echo "[offsite]" > "$tmp/root/config/rclone.conf"
dump="$tmp/root/backups/mongo-20261025T031800Z.archive.gz"; echo data > "$dump"
fail=0
check() { if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; fail=1; fi; }

export PATH="$tmp/bin:$PATH" GT_ROOT="$tmp/root" GT_CONFIG="$tmp/root/config" FAKE_DOCKER_LOG="$tmp/call"
bash "$script" offsite:garnishtable-backups "$dump" > "$tmp/out" 2>&1; rc=$?
check "copies successfully" '[ "$rc" = 0 ]'
args="$(tr '\n' ' ' < "$tmp/call")"
check "rclone copyto <dump> <remote>/<name> (source first)" '[[ "$args" == *"copyto --quiet /data/mongo-20261025T031800Z.archive.gz offsite:garnishtable-backups/mongo-20261025T031800Z.archive.gz"* ]]'
check "mounts the rclone config and the backups read-only" '[[ "$args" == *"rclone.conf:/config/rclone/rclone.conf:ro"* && "$args" == *"/backups:/data:ro"* ]]'
check "never runs a delete/sync" '[[ "$args" != *" sync "* && "$args" != *" delete"* && "$args" != *" move"* ]]'

rm -f "$tmp/call"
bash "$script" "$dump" > /dev/null 2>&1; rc=$?
check "refuses the old argument order (file only, no remote)" '[ "$rc" != 0 ] && [ ! -f "$tmp/call" ]'
bash "$script" not-a-remote "$dump" > /dev/null 2>&1; rc=$?
check "refuses a destination that is not an rclone remote" '[ "$rc" != 0 ] && [ ! -f "$tmp/call" ]'
rm -f "$tmp/root/config/rclone.conf"
bash "$script" offsite:x "$dump" > /dev/null 2>&1; rc=$?
check "refuses without rclone.conf" '[ "$rc" != 0 ] && [ ! -f "$tmp/call" ]'
exit $fail
