#!/usr/bin/env bash
# Phase 87 — deployment rehearsal on a SIMULATED SERVER (the CI runner). Drives the real server
# scripts (deploy.sh, rollback.sh, smoke-test.sh, backup.sh, restore.sh, healthwatch.sh,
# cleanup-images.sh) against the real CI-built registry images, exactly as an operator would on
# the VPS. Only the outside world is simulated: Let's Encrypt → Pebble (test CA), DNS →
# challtestsrv, Atlas → a throwaway MongoDB container.
#
#   REG=ghcr.io/<owner>/<repo> CUR_SHA=<commit> [PREV_SHA=<commit>] bash infrastructure/production/test/deploy-rehearsal.sh
#
# PREV_SHA (an earlier commit whose images are in the registry) enables the version-to-version
# deploy and rollback checks. Requires Docker + Compose v2, git, curl, jq, openssl, sudo (crash and
# daemon-restart tests). Throwaway values only. Exit code is non-zero if any check fails.
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
PROD="$ROOT/infrastructure/production"
SCRIPTS="$PROD/scripts"
: "${REG:?REG (image registry) is required}" "${CUR_SHA:?CUR_SHA is required}"
PREV_SHA="${PREV_SHA:-}"
CUR="sha-$CUR_SHA"; PREV="${PREV_SHA:+sha-$PREV_SHA}"
SIM="${SIM_DIR:-$(mktemp -d)}"
RESULTS="$SIM/results.txt"; : > "$RESULTS"
BASE=garnishtable.example

export GT_ROOT="$SIM/server" GT_COMPOSE_EXTRA_FILES="$PROD/test/docker-compose.test.yml"
export GT_SMOKE_CACERT="$SIM/pebble-root.pem" GT_BACKUP_NETWORK=garnishtable_backend GT_WAIT_TIMEOUT=240
# CI runners' root disks are routinely >85% full before we start; the threshold is a server setting.
export GT_DISK_ALERT_PCT=97
EDGE_ENV="$GT_ROOT/config/edge.env"

pass() { echo "PASS | $1 | $2" | tee -a "$RESULTS"; }
fail() {
  echo "FAIL | $1 | $2" | tee -a "$RESULTS"
  # Annotate immediately, so a failure is visible even if the job dies later.
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error title=Rehearsal FAIL::$1 | ${2:0:300}"
  return 0
}
info() { echo "INFO | $1 | $2" | tee -a "$RESULTS"; }
check() { local name="$1" detail="$2"; shift 2; if "$@"; then pass "$name" "$detail"; else fail "$name" "$detail"; fi; }
section() {
  echo; echo "=== $*"
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::notice title=Rehearsal progress::$* (so far $(grep -c '^PASS' "$RESULTS") passed, $(grep -c '^FAIL' "$RESULTS") failed)"
  return 0
}
step() {  # step <logname> <cmd…> — full output to $SIM/<logname>.log, exit code in RC
 local log="$1"; shift; "$@" > "$SIM/$log.log" 2>&1; RC=$?; }

hc() { curl -sS -m 20 --cacert "$GT_SMOKE_CACERT" --resolve "$1:443:127.0.0.1" "https://$1$2" "${@:3}"; }
api_commit() { hc "api.$BASE" /health/live 2> /dev/null | jq -r '.data.version.commit // empty' 2> /dev/null; }
ready_code() { hc "api.$BASE" /health -o /dev/null -w '%{http_code}' 2> /dev/null; }
cid() { docker ps -q --filter label=com.docker.compose.project=garnishtable --filter "label=com.docker.compose.service=$1" --filter label=com.docker.compose.oneoff=False | head -1; }
state() { cat "$GT_ROOT/state/$1" 2> /dev/null; }
wait_healthy() {  # wait_healthy <seconds> — every app container healthy
  local end=$(( $(date +%s) + $1 )) s ok
  while [ "$(date +%s)" -lt "$end" ]; do
    ok=1
    for s in caddy api web admin marketing; do
      [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$(cid $s)" 2> /dev/null)" = healthy ] || ok=0
    done
    [ "$ok" = 1 ] && return 0
    sleep 3
  done
  return 1
}
smoke() { "$SCRIPTS/smoke-test.sh" --expect "$1" > "$SIM/smoke-$2.log" 2>&1; }
smoke_summary() { grep '^RESULT' "$SIM/smoke-$1.log" | head -1; }
serial() { echo | openssl s_client -connect 127.0.0.1:443 -servername "app.$BASE" 2> /dev/null | openssl x509 -noout -serial 2> /dev/null | cut -d= -f2; }
# SIGKILL the container's main process from the host. Guarded: a container that is (re)starting
# reports PID 0, and "kill -9 0" would signal this script's whole process group.
crash() {
  local pid; pid="$(docker inspect -f '{{.State.Pid}}' "$(cid "$1")" 2> /dev/null)"
  if [ "${pid:-0}" -gt 1 ] 2> /dev/null; then sudo kill -9 "$pid"; else echo "crash $1: no running process (pid '${pid}')"; return 1; fi
}

teardown() {
  section "teardown"
  docker compose -p garnishtable down -v --remove-orphans > /dev/null 2>&1 || true
}
trap teardown EXIT

# ---------------------------------------------------------------------------------------------------
section "1. simulated server: layout, configuration, outside-world stand-ins"
mkdir -p "$GT_ROOT/config" "$SIM/testdir"
git clone --quiet "$ROOT" "$GT_ROOT/repo"
REDIS_PW=$(openssl rand -hex 16); JWT_A=$(openssl rand -hex 32); JWT_B=$(openssl rand -hex 32)
[ -n "${GITHUB_ACTIONS:-}" ] && { echo "::add-mask::$REDIS_PW"; echo "::add-mask::$JWT_A"; echo "::add-mask::$JWT_B"; }
umask 077
cat > "$EDGE_ENV" <<EOF
MARKETING_HOST=$BASE
WWW_HOST=www.$BASE
APP_HOST=app.$BASE
AGENCY_HOST=agency.$BASE
ADMIN_HOST=admin.$BASE
POS_HOST=pos.$BASE
ORDER_HOST=order.$BASE
API_HOST=api.$BASE
CUSTOM_DOMAIN_CNAME_TARGET=domains.$BASE
CUSTOM_DOMAIN_TLS_ASK_PORT=4001
ACME_EMAIL=rehearsal@$BASE
ACME_CA=https://pebble:14000/dir
CADDY_RENEW_INTERVAL=10m
GT_EDGE_SUBNET=172.30.86.0/24
GT_CADDY_IP=172.30.86.10
GT_IMAGE_REGISTRY=$REG
GT_API_ENV_FILE=$GT_ROOT/config/api.env
GT_COMPOSE_PROFILES=local-redis
REDIS_PASSWORD=$REDIS_PW
GT_TEST_DIR=$SIM/testdir
GT_TEST_CA_BUNDLE=$SIM/ca-bundle.pem
EOF
cat > "$GT_ROOT/config/api.env" <<EOF
MONGO_URI=mongodb://mongo:27017/gt_rehearsal?replicaSet=rs0
REDIS_URL=redis://:$REDIS_PW@redis:6379
JWT_ACCESS_SECRET=$JWT_A
JWT_REFRESH_SECRET=$JWT_B
EMAIL_PROVIDER=smtp
SMTP_HOST=127.0.0.1
SMTP_PORT=2525
EMAIL_FROM=GarnishTable <no-reply@$BASE>
CONTACT_NOTIFICATION_EMAIL=hello@$BASE
GEOCODING_PROVIDER=test
PAYMENT_PROVIDER=mock
POS_TERMINAL_PROVIDER=none
BILLING_PROVIDER=mock
MARKETPLACE_PROVIDER_MODE=mock
MENU_EXTRACTION_PROVIDER_MODE=mock
DNS_VERIFIER=node
EOF
umask 022
# Long-lived test certificates (the Phase 86 harness uses 4-minute ones to watch renewals).
jq '.pebble.profiles.default.validityPeriod = 7776000' "$PROD/test/pebble-config.json" > "$SIM/testdir/pebble-config.json"
docker run --rm caddy:2.10-alpine cat /etc/ssl/certs/ca-certificates.crt > "$SIM/ca-bundle.pem"

# Stand-ins start first, from the checked-out compose files (same project as the deployments).
sim_dc() { GT_IMAGE_TAG="$CUR" GT_IMAGE_REGISTRY="$REG" docker compose -p garnishtable --env-file "$EDGE_ENV" \
  -f "$PROD/docker-compose.yml" -f "$PROD/test/docker-compose.test.yml" --profile local-redis "$@"; }
sim_dc up -d mongo redis challtestsrv pebble > "$SIM/infra.log" 2>&1
for i in $(seq 1 60); do sim_dc exec -T mongo mongosh --quiet --eval 'db.runCommand({ping:1}).ok' > /dev/null 2>&1 && break; sleep 1; done
sim_dc exec -T mongo mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"mongo:27017"}]}).ok' > /dev/null
for i in $(seq 1 60); do [ "$(sim_dc exec -T mongo mongosh --quiet --eval 'db.hello().isWritablePrimary')" = "true" ] && break; sleep 1; done
sim_dc cp pebble:/test/certs/pebble.minica.pem "$SIM/pebble.minica.pem" > /dev/null 2>&1
cat "$SIM/pebble.minica.pem" >> "$SIM/ca-bundle.pem"
for i in $(seq 1 30); do curl -sfk https://127.0.0.1:15000/roots/0 > "$GT_SMOKE_CACERT" && break; sleep 1; done
check "Stand-ins ready (MongoDB replica set, Redis 7, Pebble, challtestsrv)" "$(sim_dc ps --format '{{.Service}}={{.State}}' | tr '\n' ' ')" \
  test "$(sim_dc exec -T mongo mongosh --quiet --eval 'db.hello().isWritablePrimary')" = true
info "Rehearsal" "current $CUR_SHA, previous ${PREV_SHA:-none (first image set in the registry)}"

# ---------------------------------------------------------------------------------------------------
section "2. tag validation (nothing may deploy a moving or ambiguous tag)"
for bad in latest main "sha-${CUR_SHA:0:12}" "${CUR_SHA}" "sha-$(printf 'Z%.0s' {1..40})"; do
  step refuse "$SCRIPTS/deploy.sh" "$bad"
  check "deploy.sh refuses tag '$bad'" "exit $RC: $(grep -o 'ERROR.*' "$SIM/refuse.log" | head -1 | cut -c1-90)" test "$RC" -ne 0
done
step unknown "$SCRIPTS/deploy.sh" "sha-$(printf '0%.0s' {1..40})"
check "deploy.sh refuses a commit that does not exist" "exit $RC: $(grep -o 'ERROR.*' "$SIM/unknown.log" | head -1 | cut -c1-90)" test "$RC" -ne 0

# ---------------------------------------------------------------------------------------------------
section "3. deployments"
if [ -n "$PREV" ]; then
  step deploy-prev "$SCRIPTS/deploy.sh" "$PREV" --init
  check "Deploy previous version $PREV_SHA (first deploy, --init)" "exit $RC, $(grep -o 'DEPLOY.*' "$SIM/deploy-prev.log" | tail -1)" test "$RC" -eq 0
  check "Running system reports previous commit" "$(api_commit)" test "$(api_commit)" = "$PREV_SHA"
  step deploy-cur "$SCRIPTS/deploy.sh" "$CUR"
  check "Deploy current version $CUR_SHA over it" "exit $RC, $(grep -o 'DEPLOY.*' "$SIM/deploy-cur.log" | tail -1)" test "$RC" -eq 0
  check "Rollback target recorded (state/previous)" "$(state previous)" test "$(state previous)" = "$PREV $REG"
else
  step deploy-cur "$SCRIPTS/deploy.sh" "$CUR" --init
  check "Deploy current version $CUR_SHA (first deploy, --init)" "exit $RC, $(grep -o 'DEPLOY.*' "$SIM/deploy-cur.log" | tail -1)" test "$RC" -eq 0
fi
[ "$RC" -eq 0 ] || { tail -60 "$SIM/deploy-cur.log"; }
edge_diag() {
  info "diag: certificates in caddy_data" "$(docker run --rm -v garnishtable_caddy_data:/d:ro caddy:2.10-alpine sh -c 'find /d -name "*.crt" | wc -l')"
  info "diag: caddy → pebble ACME directory" "$(docker exec "$(cid caddy)" wget -q -O /dev/null https://pebble:14000/dir 2>&1 | head -1; echo "exit=$?")"
  info "diag: CA bundle" "$(grep -c 'BEGIN CERTIFICATE' "$SIM/ca-bundle.pem") certs, minica $(test -s "$SIM/pebble.minica.pem" && echo present || echo MISSING), pebble root $(test -s "$GT_SMOKE_CACERT" && echo present || echo MISSING)"
  docker logs "$(cid caddy)" 2>&1 | grep -iE 'error|obtain|acme|challenge|certificate' | grep -v 'handled request' | tail -8 | while read -r l; do info "diag: caddy" "$(echo "$l" | cut -c1-260)"; done
  docker logs "$(docker ps -aq --filter label=com.docker.compose.service=pebble | head -1)" 2>&1 | tail -6 | while read -r l; do info "diag: pebble" "$(echo "$l" | cut -c1-260)"; done
}
grep -q '^RESULT: PASS' "$SIM/deploy-cur.log" || edge_diag
check "Running system reports current commit (GET /health/live)" "$(api_commit)" test "$(api_commit)" = "$CUR_SHA"
check "state/current names the deployed tag" "$(state current)" test "$(state current)" = "$CUR $REG"
check "Deploy smoke test passed" "$(grep '^RESULT' "$SIM/deploy-cur.log" | tail -1)" grep -q '^RESULT: PASS' "$SIM/deploy-cur.log"
grep -E '^(PASS|FAIL|WARN) ' "$SIM/deploy-cur.log" | while read -r l; do info "smoke (deploy)" "$l"; done
check "Indexes built during deploy" "$(grep -o 'ensure-indexes. built indexes for [0-9]* models' "$SIM/deploy-cur.log" | head -1)" grep -q 'built indexes for' "$SIM/deploy-cur.log"
hist="$(tail -1 "$GT_ROOT/state/history.log")"
check "Deployment history records tag, registry and image digests" "${hist:0:200}" sh -c "echo '$hist' | grep -q ' ok $CUR .* api=sha256:'"
for s in api web admin marketing; do
  rev=$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$(cid $s)")
  img=$(docker inspect -f '{{.Config.Image}}' "$(cid $s)")
  check "Container $s runs $REG/$s:$CUR built from that commit" "$img rev=${rev:0:12}" test "$img" = "$REG/$s:$CUR" -a "$rev" = "$CUR_SHA"
done
seeded=$(sim_dc exec -T mongo mongosh --quiet gt_rehearsal --eval 'db.plans.countDocuments()')
check "--init seeded the plan catalog" "$seeded plans" test "${seeded:-0}" -gt 0
step deploy-again "$SCRIPTS/deploy.sh" "$CUR"
check "Redeploying the live tag is idempotent (no --init, data kept)" "exit $RC, plans $(sim_dc exec -T mongo mongosh --quiet gt_rehearsal --eval 'db.plans.countDocuments()')" \
  test "$RC" -eq 0 -a "$(sim_dc exec -T mongo mongosh --quiet gt_rehearsal --eval 'db.plans.countDocuments()')" = "$seeded"
[ -n "$PREV" ] && check "Redeploy keeps the rollback target" "$(state previous)" test "$(state previous)" = "$PREV $REG"

# ---------------------------------------------------------------------------------------------------
section "4. failed deployment → automatic rollback"
# A build that starts but never becomes healthy: the real images with the API command replaced.
printf 'FROM %s\nCMD ["node","-e","console.error(\\"rehearsal: deliberately broken build\\");process.exit(1)"]\n' "$REG/api:$CUR" \
  | docker build -q -t "local-broken/api:$CUR" - > /dev/null
for s in web admin marketing; do docker tag "$REG/$s:$CUR" "local-broken/$s:$CUR"; done
step deploy-broken env GT_IMAGE_REGISTRY=local-broken GT_WAIT_TIMEOUT=90 "$SCRIPTS/deploy.sh" "$CUR" --no-pull --skip-indexes
check "Broken deployment is reported as failed and rolled back (exit 2)" "exit $RC, $(grep -o 'DEPLOY FAILED.*' "$SIM/deploy-broken.log" | tail -1)" test "$RC" -eq 2
check "After auto-rollback the good build serves again" "$(api_commit), api image $(docker inspect -f '{{.Config.Image}}' "$(cid api)")" \
  test "$(api_commit)" = "$CUR_SHA" -a "$(docker inspect -f '{{.Config.Image}}' "$(cid api)")" = "$REG/api:$CUR"
check "state/current still names the good build" "$(state current)" test "$(state current)" = "$CUR $REG"
check "Failure diagnostics saved (mode 600)" "$(ls "$GT_ROOT/state" | grep failed- | head -1)" \
  sh -c "ls '$GT_ROOT'/state/failed-* > /dev/null 2>&1 && [ \"\$(stat -c %a \$(ls '$GT_ROOT'/state/failed-* | head -1))\" = 600 ]"
check "History records the failure and the rollback" "$(grep -c 'FAILED\|auto-rollback ok' "$GT_ROOT/state/history.log") lines" grep -q 'auto-rollback ok' "$GT_ROOT/state/history.log"

# ---------------------------------------------------------------------------------------------------
section "5. operator rollback (rollback.sh) and roll forward"
if [ -n "$PREV" ]; then
  step rollback "$SCRIPTS/rollback.sh"
  check "rollback.sh returns to the previous version" "exit $RC, running $(api_commit)" test "$RC" -eq 0 -a "$(api_commit)" = "$PREV_SHA"
  v=$(hc "order.$BASE" /version.json 2> /dev/null | jq -r .commit)
  check "Frontends rolled back too (order.$BASE/version.json)" "$v" test "$v" = "$PREV_SHA"
  check "Rollback ran smoke verification" "$(grep '^RESULT' "$SIM/rollback.log" | tail -1)" grep -q '^RESULT: PASS' "$SIM/rollback.log"
  step rollforward "$SCRIPTS/rollback.sh" "$CUR"
  check "rollback.sh <tag> rolls forward to the current version" "exit $RC, running $(api_commit)" test "$RC" -eq 0 -a "$(api_commit)" = "$CUR_SHA"
else
  info "rollback.sh" "SKIPPED: needs a previous image set in the registry (re-run on the next commit)"
fi

# ---------------------------------------------------------------------------------------------------
section "6. crash and restart behaviour"
s_before=$(serial)
for svc in api web caddy; do
  wait_healthy 120 > /dev/null
  crash "$svc" || { fail "Crash of $svc (SIGKILL) → restarted by Docker and healthy" "container not running before the test"; continue; }
  sleep 2
  if wait_healthy 180; then pass "Crash of $svc (SIGKILL) → restarted by Docker and healthy" "restart count $(docker inspect -f '{{.RestartCount}}' "$(cid $svc)")"
  else fail "Crash of $svc (SIGKILL) → restarted by Docker and healthy" "$(docker ps -a --format '{{.Names}} {{.Status}}' | tr '\n' ';')"; fi
done
smoke "$CUR_SHA" after-crashes
check "Smoke test after crashes" "$(smoke_summary after-crashes)" grep -q '^RESULT: PASS' "$SIM/smoke-after-crashes.log"
check "Certificates survived the Caddy restart (no re-issuance)" "serial $s_before → $(serial)" test -n "$s_before" -a "$s_before" = "$(serial)"

# Redis outage: readiness must report it, liveness must not (no restart loop), and recover after.
docker stop "$(cid redis)" > /dev/null
sleep 5
r_down=$(ready_code); l_down=$(hc "api.$BASE" /health/live -o /dev/null -w '%{http_code}')
check "Redis down → API readiness 503, liveness still 200" "ready=$r_down live=$l_down" test "$r_down" = 503 -a "$l_down" = 200
docker start "$(docker ps -aq --filter label=com.docker.compose.project=garnishtable --filter label=com.docker.compose.service=redis | head -1)" > /dev/null
for i in $(seq 1 40); do [ "$(ready_code)" = 200 ] && break; sleep 3; done
check "Redis back → API ready again" "ready=$(ready_code)" test "$(ready_code)" = 200
for i in $(seq 1 20); do docker exec "$(cid api)" node dist/scripts/queueStatus.js 2> /dev/null | grep -q '"workers":[1-9]' && break; sleep 3; done
qs=$(docker exec "$(cid api)" node dist/scripts/queueStatus.js 2>&1 | tail -1)
check "BullMQ worker reconnected after the Redis outage" "${qs:0:200}" sh -c "echo '$qs' | grep -q '\"workers\":[1-9]'"

# Docker daemon restart — the closest a CI runner gets to a server reboot (same restart policies).
sudo systemctl restart docker
if wait_healthy 240; then pass "Docker daemon restart (reboot simulation) → stack back without intervention" "$(docker ps --filter label=com.docker.compose.project=garnishtable --format '{{.Names}}' | wc -l) containers"
else fail "Docker daemon restart (reboot simulation) → stack back without intervention" "$(docker ps -a --format '{{.Names}} {{.Status}}' | tr '\n' ';')"; fi
for i in $(seq 1 30); do [ "$(ready_code)" = 200 ] && break; sleep 3; done
smoke "$CUR_SHA" after-daemon-restart
check "Smoke test after daemon restart" "$(smoke_summary after-daemon-restart)" grep -q '^RESULT: PASS' "$SIM/smoke-after-daemon-restart.log"
grep -E '^(FAIL|WARN) ' "$SIM/smoke-after-daemon-restart.log" | while read -r l; do info "smoke (after restart)" "$l"; done

# ---------------------------------------------------------------------------------------------------
section "7. backup, restore, health watch, image cleanup"
step backup "$SCRIPTS/backup.sh"
archive=$(tail -1 "$SIM/backup.log")
check "backup.sh produced a MongoDB dump (mode 600)" "exit $RC, $(basename "$archive") $(du -h "$archive" 2> /dev/null | cut -f1)" \
  sh -c "[ $RC -eq 0 ] && [ -s '$archive' ] && [ \"\$(stat -c %a '$archive')\" = 600 ]"
check "backup.sh saved the Caddy certificate store" "$(ls "$GT_ROOT/backups" | grep caddy- | head -1)" sh -c "ls '$GT_ROOT'/backups/caddy-*.tar.gz > /dev/null 2>&1"
grep 'WARNING' "$SIM/backup.log" | while read -r l; do info "backup.sh" "${l:0:300}"; done
check "Backup log never shows the connection string" "grep mongodb:// in logs" sh -c "! grep -q 'mongodb://' '$SIM/backup.log'"
step restore "$SCRIPTS/restore.sh" "$archive" --to-db gt_restore_check
count='db.getCollectionNames().reduce((n,c)=>n+db.getCollection(c).countDocuments(),0)'
live=$(sim_dc exec -T mongo mongosh --quiet gt_rehearsal --eval "$count"); restored=$(sim_dc exec -T mongo mongosh --quiet gt_restore_check --eval "$count")
check "restore.sh --to-db restores every document" "exit $RC, live=$live restored=$restored" test "$RC" -eq 0 -a "${restored:-x}" = "${live:-y}" -a "${live:-0}" -gt 0
step restore-guard "$SCRIPTS/restore.sh" "$archive" --replace-production
check "restore.sh --replace-production refuses without explicit confirmation" "exit $RC" test "$RC" -ne 0

step healthwatch "$SCRIPTS/healthwatch.sh"
check "healthwatch.sh reports healthy" "exit $RC, $(tail -1 "$SIM/healthwatch.log" | cut -c1-160)" test "$RC" -eq 0
docker stop "$(cid web)" > /dev/null
step healthwatch-down "$SCRIPTS/healthwatch.sh"
check "healthwatch.sh detects a stopped frontend" "exit $RC, $(grep -o 'UNHEALTHY.*' "$SIM/healthwatch-down.log" | head -1 | cut -c1-160)" test "$RC" -ne 0
docker start "$(docker ps -aq --filter label=com.docker.compose.project=garnishtable --filter label=com.docker.compose.service=web | head -1)" > /dev/null
wait_healthy 120 > /dev/null

step cleanup "$SCRIPTS/cleanup-images.sh"
kept=1; for s in api web admin marketing; do docker image inspect "$REG/$s:$CUR" > /dev/null 2>&1 || kept=0; [ -n "$PREV" ] && { docker image inspect "$REG/$s:$PREV" > /dev/null 2>&1 || kept=0; }; done
check "cleanup-images.sh keeps the live and rollback images" "exit $RC, $(tail -1 "$SIM/cleanup.log" | cut -c1-160)" test "$RC" -eq 0 -a "$kept" = 1

# ---------------------------------------------------------------------------------------------------
section "8. exposure, logging, resources"
public=$(docker ps --filter label=com.docker.compose.project=garnishtable --format '{{.Label "com.docker.compose.service"}} {{.Ports}}' | grep -E '0\.0\.0\.0|:::' | awk '{print $1}' | sort -u | tr '\n' ' ')
check "Only Caddy publishes ports on public interfaces" "${public:-none}" test "$(echo $public)" = caddy
local_only=$(docker ps --filter label=com.docker.compose.project=garnishtable --format '{{.Label "com.docker.compose.service"}} {{.Ports}}' | grep '127.0.0.1' | awk '{print $1}' | tr '\n' ' ')
info "Loopback-only ports (test stand-ins, not in production compose)" "${local_only:-none}"
check "Backend network is internal (no internet route)" "$(docker network inspect -f '{{.Internal}}' garnishtable_backend)" test "$(docker network inspect -f '{{.Internal}}' garnishtable_backend)" = true
for s in caddy api web; do
  lc=$(docker inspect -f '{{.HostConfig.LogConfig.Type}} {{index .HostConfig.LogConfig.Config "max-size"}} x{{index .HostConfig.LogConfig.Config "max-file"}}' "$(cid $s)")
  check "Log rotation applied to $s" "$lc" test "$lc" = "json-file 10m x5"
done
check "API runs as non-root" "user=$(docker exec "$(cid api)" id -un)" test "$(docker exec "$(cid api)" id -un)" = node
info "Memory (idle, after tests)" "$(docker stats --no-stream --format '{{.Name}}={{.MemUsage}}' | grep garnishtable | sed 's/ \/ [^ ]*//' | tr '\n' ' ')"
info "Disk used by images" "$(docker system df --format '{{.Type}} {{.Size}}' | tr '\n' ' ')"

section "summary"
p=$(grep -c '^PASS' "$RESULTS"); f=$(grep -c '^FAIL' "$RESULTS")
echo "RESULT: $p passed, $f failed"
[ "$f" -eq 0 ]
