#!/usr/bin/env bash
# GarnishTable production smoke test (Phase 87). Prints one PASS/FAIL/WARN line per check and exits
# non-zero if any check FAILs. Read-only: it creates, changes and deletes nothing.
#
#   smoke-test.sh [--expect <40-char commit>] [--public] [--wait <seconds>]
#
#   --expect   every component must report this Git commit (API /health/live, each /version.json)
#   --public   go through public DNS instead of pinning the hostnames to this server (run it from
#              anywhere to check DNS + certificates end to end; container checks are then skipped)
#   --wait     first wait up to this long for every hostname to complete a verified TLS handshake
#              (a first deploy obtains its certificates in the background after Caddy starts)
#
# Hostnames come from edge.env. By default each hostname is resolved to GT_SMOKE_TARGET
# (127.0.0.1), so the check tests THIS server's edge even before DNS points at it.
# TEST ONLY: GT_SMOKE_CACERT trusts an extra CA (the CI simulated server's test CA).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GT_LOG_TAG=smoke
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"
set +e

EXPECT="" PUBLIC=0 WAIT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --expect) EXPECT="$2"; shift ;;
    --public) PUBLIC=1 ;;
    --wait) WAIT="$2"; shift ;;
    *) die "unknown option $1" ;;
  esac
  shift
done
TARGET="${GT_SMOKE_TARGET:-127.0.0.1}"
FAILS=0 PASSES=0 WARNS=0
pass() { PASSES=$((PASSES + 1)); echo "PASS  $1${2:+ — $2}"; }
fail() { FAILS=$((FAILS + 1)); echo "FAIL  $1${2:+ — $2}"; }
warn() { WARNS=$((WARNS + 1)); echo "WARN  $1${2:+ — $2}"; }

host() { local v; v="$(env_value "$GT_EDGE_ENV" "$1")"; [ -n "$v" ] || die "$1 is not set in $GT_EDGE_ENV"; printf '%s' "$v"; }
MARKETING_HOST="$(host MARKETING_HOST)"; APP_HOST="$(host APP_HOST)"; AGENCY_HOST="$(host AGENCY_HOST)"
ADMIN_HOST="$(host ADMIN_HOST)"; POS_HOST="$(host POS_HOST)"; ORDER_HOST="$(host ORDER_HOST)"; API_HOST="$(host API_HOST)"

# curl pinned to this server (unless --public); TLS is always verified.
req() {  # req <url> [curl args…] — prints body; HTTP status in $CODE
  local url="$1"; shift
  local h="${url#*://}"; h="${h%%/*}"
  local port=443; [ "${url%%:*}" = http ] && port=80
  local args=(-sS -m 20 -o "$TMPB" -w '%{http_code}')
  [ "$PUBLIC" = 1 ] || args+=(--resolve "$h:$port:$TARGET")
  [ -n "${GT_SMOKE_CACERT:-}" ] && args+=(--cacert "$GT_SMOKE_CACERT")
  CODE="$(curl "${args[@]}" "$@" "$url" 2> "$TMPE")"; CURL_RC=$?
  cat "$TMPB"
}
TMPB="$(mktemp)"; TMPE="$(mktemp)"; trap 'rm -f "$TMPB" "$TMPE"' EXIT
json_str() { grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
commit_ok() {  # commit_ok <label> <reported>
  if [ -z "$EXPECT" ]; then pass "$1 reports a version" "${2:0:12}"
  elif [ "$2" = "$EXPECT" ]; then pass "$1 runs the expected commit" "${2:0:12}"
  else fail "$1 runs the expected commit" "reports '${2:-none}', expected ${EXPECT:0:12}"; fi
}

echo "GarnishTable smoke test — $(date -u +%Y-%m-%dT%H:%M:%SZ)${EXPECT:+ — expecting ${EXPECT:0:12}}"

if [ "$WAIT" -gt 0 ] 2> /dev/null; then
  deadline=$(( $(date +%s) + WAIT )); started=$(date +%s)
  for h in "$MARKETING_HOST" "$APP_HOST" "$AGENCY_HOST" "$ADMIN_HOST" "$POS_HOST" "$ORDER_HOST" "$API_HOST"; do
    until req "https://$h/" > /dev/null && [ "$CURL_RC" = 0 ]; do
      [ "$(date +%s)" -lt "$deadline" ] || break 2
      sleep 3
    done
  done
  echo "(waited $(( $(date +%s) - started ))s for certificates)"
fi

# --- Containers ------------------------------------------------------------------------------------
if [ "$PUBLIC" = 0 ]; then
  for svc in caddy api web admin marketing; do
    st="$(docker ps --filter "label=com.docker.compose.project=$GT_PROJECT" --filter "label=com.docker.compose.service=$svc" \
      --filter "label=com.docker.compose.oneoff=False" --format '{{.Status}}' | head -1)"
    case "$st" in *"(healthy)"*) pass "container $svc healthy" "$st" ;; *) fail "container $svc healthy" "${st:-not running}" ;; esac
  done
fi

# --- Edge: HTTP→HTTPS, certificates ----------------------------------------------------------------
req "http://$APP_HOST/" -I > /dev/null
loc="$(curl -sS -m 10 -o /dev/null -w '%{redirect_url}' $([ "$PUBLIC" = 1 ] || echo --resolve "$APP_HOST:80:$TARGET") "http://$APP_HOST/" 2> /dev/null)"
case "$CODE" in 301 | 308) [ "${loc#https://}" != "$loc" ] && pass "HTTP redirects to HTTPS" "$CODE → $loc" || fail "HTTP redirects to HTTPS" "$CODE → $loc" ;;
  *) fail "HTTP redirects to HTTPS" "got $CODE" ;; esac

# --- API -------------------------------------------------------------------------------------------
body="$(req "https://$API_HOST/health/live")"
if [ "$CODE" = 200 ]; then pass "API liveness https://$API_HOST/health/live" "TLS verified"; commit_ok "API" "$(json_str commit <<< "$body")"
else fail "API liveness https://$API_HOST/health/live" "HTTP $CODE $(head -c 200 "$TMPE")"; fi

body="$(req "https://$API_HOST/health")"
if [ "$CODE" = 200 ] && [ "$(json_str status <<< "$body")" = ok ]; then pass "API readiness (MongoDB + Redis)" "$(grep -o '"dependencies":{[^}]*}' <<< "$body")"
else fail "API readiness (MongoDB + Redis)" "HTTP $CODE $(grep -o '"dependencies":{[^}]*}' <<< "$body")"; fi

# --- Frontends: routing (each hostname serves the right app) and version ---------------------------
check_frontend() {  # check_frontend <host> <app>
  local b
  b="$(req "https://$1/")"
  if [ "$CODE" = 200 ] && grep -qi '<!doctype html' <<< "$b"; then pass "https://$1/ serves the $2 app shell"; else fail "https://$1/ serves the $2 app shell" "HTTP $CODE $(head -c 200 "$TMPE")"; fi
  b="$(req "https://$1/version.json")"
  local app; app="$(json_str app <<< "$b")"
  if [ "$CODE" = 200 ] && [ "$app" = "$2" ]; then pass "https://$1 is routed to $2"; else fail "https://$1 is routed to $2" "HTTP $CODE, version.json app='${app}'"; fi
  commit_ok "$2 at $1" "$(json_str commit <<< "$b")"
}
check_frontend "$MARKETING_HOST" marketing
check_frontend "$ORDER_HOST" web
for h in "$APP_HOST" "$AGENCY_HOST" "$ADMIN_HOST" "$POS_HOST"; do check_frontend "$h" admin; done

# Same-origin /api proxy through a frontend's nginx (how every browser reaches the API).
for h in "$ORDER_HOST" "$MARKETING_HOST"; do
  b="$(req "https://$h/api/v1/public/plans")"
  if [ "$CODE" = 200 ] && grep -q '"success":true' <<< "$b"; then pass "https://$h/api/v1 reaches the API"; else fail "https://$h/api/v1 reaches the API" "HTTP $CODE"; fi
done

# --- Realtime: Socket.IO handshake, origin enforcement -----------------------------------------------
b="$(req "https://$API_HOST/socket.io/?EIO=4&transport=polling" -H "Origin: https://$APP_HOST")"
if [ "$CODE" = 200 ] && [ "${b:0:8}" = '0{"sid":' ]; then pass "Socket.IO handshake from https://$APP_HOST"; else fail "Socket.IO handshake from https://$APP_HOST" "HTTP $CODE ${b:0:60}"; fi
req "https://$API_HOST/socket.io/?EIO=4&transport=polling" -H "Origin: https://smoke-test-not-allowed.invalid" > /dev/null
if [ "$CODE" != 200 ]; then pass "Socket.IO refuses an unknown origin" "HTTP $CODE"; else fail "Socket.IO refuses an unknown origin" "HTTP 200"; fi

# --- Custom domains: no certificate for a hostname no restaurant owns --------------------------------
if [ "$PUBLIC" = 0 ]; then
  unmapped="smoke-$(date +%s)-unmapped.example.com"
  req "https://$unmapped/" > /dev/null
  if [ "$CURL_RC" != 0 ]; then pass "edge refuses a certificate for an unmapped domain" "curl exit $CURL_RC"; else fail "edge refuses a certificate for an unmapped domain" "HTTP $CODE"; fi
fi

# --- Background jobs: in-process BullMQ worker and schedules -----------------------------------------
if [ "$PUBLIC" = 0 ]; then
  api_cid="$(docker ps -q --filter "label=com.docker.compose.project=$GT_PROJECT" --filter "label=com.docker.compose.service=api" --filter "label=com.docker.compose.oneoff=False" | head -1)"
  qs="$( [ -n "$api_cid" ] && docker exec "$api_cid" node dist/scripts/queueStatus.js 2>&1 | tail -1)"
  workers="$(grep -o '"workers":[0-9]*' <<< "$qs" | cut -d: -f2)"
  if [ "${workers:-0}" -ge 1 ]; then pass "BullMQ worker connected" "$workers worker(s)"; else fail "BullMQ worker connected" "${qs:0:200}"; fi
  if grep -q '"demo.cleanup_tick"' <<< "$qs"; then pass "scheduled jobs registered" "$(grep -o '"schedules":\[[^]]*\]' <<< "$qs" | tr -d '"' | cut -c1-160)"; else fail "scheduled jobs registered" "demo.cleanup_tick missing"; fi
  rv="$(json_str redisVersion <<< "$qs")"; major="${rv%%.*}"; minor="$(cut -d. -f2 <<< "$rv")"
  if [ "${major:-0}" -lt 5 ] 2> /dev/null; then fail "Redis version" "$rv (BullMQ needs ≥ 5)"
  elif [ "$major" -lt 6 ] || { [ "$major" = 6 ] && [ "${minor:-0}" -lt 2 ]; }; then warn "Redis version" "$rv (≥ 6.2 recommended)"
  else pass "Redis version" "$rv"; fi
  failed="$(grep -o '"failed":[0-9]*' <<< "$qs" | cut -d: -f2)"
  [ "${failed:-0}" -eq 0 ] && pass "no failed background jobs" || warn "failed background jobs retained" "$failed (see API logs)"
fi

echo "RESULT: $([ "$FAILS" = 0 ] && echo PASS || echo FAIL) — $PASSES passed, $FAILS failed, $WARNS warnings"
[ "$FAILS" = 0 ]
