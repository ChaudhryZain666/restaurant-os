#!/usr/bin/env bash
# GarnishTable host health watch (Phase 87). Run every 5 minutes by garnishtable-healthwatch.timer.
#
# Checks the live stack (smoke-test.sh against this server) plus the host itself: disk, memory,
# CPU load, restart loops and certificate expiry. Alerts (ALERT_WEBHOOK_URL in edge.env) only when
# the overall state CHANGES (healthy → unhealthy and back), so a long outage is one alert, not 288.
# This is an on-host check: it cannot report that the whole server is down. Pair it with an
# external uptime monitor on https://<API_HOST>/health (docs/production-deployment-runbook.md).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GT_LOG_TAG=healthwatch
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"
set +e

problems=()
live_tag="$(state_get current | cut -d' ' -f1)"
report="$(bash "$(release_smoke "$live_tag")" --expect "$(tag_commit "$live_tag")" 2>&1)"
[ $? -eq 0 ] || problems+=("smoke: $(grep '^FAIL' <<< "$report" | head -3 | tr '\n' ';')")

disk="$(df -P /var/lib/docker 2> /dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')"
[ "${disk:-0}" -lt "${GT_DISK_ALERT_PCT:-85}" ] || problems+=("disk ${disk}% used")
mem_avail="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)"
[ "${mem_avail:-0}" -ge "${GT_MEM_ALERT_MB:-200}" ] || problems+=("only ${mem_avail} MB memory available")
load="$(cut -d' ' -f1 /proc/loadavg)"; cpus="$(nproc)"
awk -v l="$load" -v c="$cpus" 'BEGIN { exit !(l > c * 2) }' && problems+=("load $load on $cpus CPUs")
for cid in $(docker ps -q --filter "label=com.docker.compose.project=$GT_PROJECT"); do
  rc="$(docker inspect --format '{{.RestartCount}} {{.Name}}' "$cid")"
  [ "${rc%% *}" -lt 3 ] || problems+=("container ${rc#* } restarted ${rc%% *} times")
done
api_host="$(env_value "$GT_EDGE_ENV" API_HOST)"
if [ -n "$api_host" ]; then
  end="$(echo | timeout 10 openssl s_client -connect 127.0.0.1:443 -servername "$api_host" 2> /dev/null | openssl x509 -noout -enddate 2> /dev/null | cut -d= -f2)"
  if [ -n "$end" ]; then
    days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
    [ "$days" -ge 14 ] || problems+=("certificate for $api_host expires in $days days (renewal is failing)")
  fi
fi

status_file="$GT_STATE/health.status"; last="$(cat "$status_file" 2> /dev/null)"
if [ ${#problems[@]} -eq 0 ]; then
  now=healthy
  [ "$last" = unhealthy ] && alert "RECOVERED — all checks pass again"
else
  now=unhealthy
  msg="$(IFS='|'; echo "${problems[*]}")"
  log "UNHEALTHY: $msg"
  [ "$last" = unhealthy ] || alert "UNHEALTHY — $msg"
fi
echo "$now" > "$status_file"
log "$now (disk ${disk}%, ${mem_avail} MB free, load $load/$cpus)"
[ "$now" = healthy ]
