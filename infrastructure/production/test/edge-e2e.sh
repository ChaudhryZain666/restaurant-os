#!/usr/bin/env bash
# Phase 86 — end-to-end verification of the production edge (Caddy) and the restaurant custom-domain
# lifecycle, using the REAL production Compose stack plus a test-only overlay (Pebble ACME test CA,
# challtestsrv DNS, throwaway MongoDB). Requires Docker + Compose v2, curl, jq, openssl.
# Optional: google-chrome (browser rendering checks).
#
#   bash infrastructure/production/test/edge-e2e.sh            # from the repository root
#
# Everything uses throwaway values generated per run; nothing touches real DNS or a public CA.
# Exit code is non-zero if any check fails.
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
PROD="$ROOT/infrastructure/production"
OUT="$PROD/test/out"
mkdir -p "$OUT"
RESULTS="$OUT/results.txt"
: > "$RESULTS"

BASE=garnishtable.example
CADDY_IP=172.30.86.10
DOMAIN=orders.wildwood-kitchen.example         # the restaurant's own domain (goes live)
OTHER=menu.verified-only.example               # verified, never activated
UNKNOWN=unknown-restaurant.example             # never added
HOSTS=("$BASE" "app.$BASE" "agency.$BASE" "admin.$BASE" "pos.$BASE" "order.$BASE" "api.$BASE")

pass() { echo "PASS | $1 | $2" | tee -a "$RESULTS"; }
fail() { echo "FAIL | $1 | $2" | tee -a "$RESULTS"; }
info() { echo "INFO | $1 | $2" | tee -a "$RESULTS"; }
check() { local name="$1" detail="$2"; shift 2; if "$@"; then pass "$name" "$detail"; else fail "$name" "$detail"; fi; }

dc() { docker compose --env-file "$OUT/edge.env" -f "$PROD/docker-compose.yml" -f "$PROD/test/docker-compose.test.yml" --profile local-redis "$@"; }
# HTTPS through the edge, trusting only Pebble's test root (no -k).
hc() { local host="$1" path="$2"; shift 2; curl -sS --max-time 20 --cacert "$OUT/pebble-root.pem" --resolve "$host:443:127.0.0.1" "$@" "https://$host$path"; }
code() { local c; c=$(hc "$1" "$2" -o /dev/null -w '%{http_code}' "${@:3}" 2>/dev/null); echo "${c:-000}"; }
ask() { dc exec -T caddy wget -q -S -O /dev/null "http://api:4001/internal/tls/ask?domain=$1" 2>&1 | grep -oE 'HTTP/[0-9.]+ [0-9]+' | tail -1 | awk '{print $2}'; }
serial() { echo | openssl s_client -connect 127.0.0.1:443 -servername "$1" 2>/dev/null | openssl x509 -noout -serial 2>/dev/null | cut -d= -f2; }
api() { local method="$1" path="$2" body="${3:-}"; hc "app.$BASE" "/api/v1$path" -X "$method" -H "Authorization: Bearer $OWNER_TOKEN" -H 'Content-Type: application/json' ${body:+-d "$body"}; }
caddy_logs() { dc logs --no-color caddy 2>/dev/null; }
api_logs() { dc logs --no-color api 2>/dev/null; }

cleanup() {
  echo "=== tearing down"
  dc down -v --remove-orphans > /dev/null 2>&1 || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------------------------------
echo "=== 1. throwaway configuration"
JWT_A=$(openssl rand -hex 32); JWT_B=$(openssl rand -hex 32); REDIS_PW=$(openssl rand -hex 16)
OWNER_PW="Owner-$(openssl rand -hex 8)"
cat > "$OUT/edge.env" <<EOF
MARKETING_HOST=$BASE
APP_HOST=app.$BASE
AGENCY_HOST=agency.$BASE
ADMIN_HOST=admin.$BASE
POS_HOST=pos.$BASE
ORDER_HOST=order.$BASE
API_HOST=api.$BASE
CUSTOM_DOMAIN_CNAME_TARGET=domains.$BASE
CUSTOM_DOMAIN_TLS_ASK_PORT=4001
ACME_EMAIL=edge-test@$BASE
ACME_CA=https://pebble:14000/dir
CADDY_RENEW_INTERVAL=15s
GT_EDGE_SUBNET=172.30.86.0/24
GT_CADDY_IP=$CADDY_IP
GT_IMAGE_TAG=edge-test
GT_API_ENV_FILE=$OUT/api.env
REDIS_PASSWORD=$REDIS_PW
EOF
cat > "$OUT/api.env" <<EOF
MONGO_URI=mongodb://mongo:27017/gt_edge_test?replicaSet=rs0
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

echo "=== 2. build images and start test infrastructure"
dc build api web admin marketing > "$OUT/build.log" 2>&1 || { tail -50 "$OUT/build.log"; fail "Build production images" "see build.log"; exit 1; }
pass "Build production images (api, web, admin, marketing)" "docker compose build"
dc config --quiet && pass "Production compose file is valid" "docker compose config" || fail "Production compose file is valid" "config error"
dc up -d mongo redis challtestsrv pebble > /dev/null 2>&1
for i in $(seq 1 60); do dc exec -T mongo mongosh --quiet --eval 'db.runCommand({ping:1}).ok' > /dev/null 2>&1 && break; sleep 1; done
dc exec -T mongo mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"mongo:27017"}]}).ok' > /dev/null
for i in $(seq 1 60); do [ "$(dc exec -T mongo mongosh --quiet --eval 'db.hello().isWritablePrimary')" = "true" ] && break; sleep 1; done
# Caddy must trust Pebble's ACME endpoint: system roots + Pebble's test root.
dc cp pebble:/test/certs/pebble.minica.pem "$OUT/pebble.minica.pem" > /dev/null 2>&1
docker run --rm caddy:2.10-alpine cat /etc/ssl/certs/ca-certificates.crt > "$OUT/ca-bundle.pem"
cat "$OUT/pebble.minica.pem" >> "$OUT/ca-bundle.pem"

echo "=== 3. start the production stack"
dc up -d > "$OUT/up.log" 2>&1 || { cat "$OUT/up.log"; }
for i in $(seq 1 90); do [ "$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q caddy)" 2>/dev/null)" = healthy ] && break; sleep 2; done
for svc in caddy api web admin marketing redis; do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$(dc ps -q $svc)" 2>/dev/null)
  check "Container $svc healthy" "$st" test "$st" = healthy
done
# Pebble signs certificates with a root generated at start-up — fetch it for client-side verification.
curl -sk https://127.0.0.1:15000/roots/0 > "$OUT/pebble-root.pem"

diag() {
  info "diag: CA bundle" "$(grep -c 'BEGIN CERTIFICATE' "$OUT/ca-bundle.pem") certs, pebble minica $(test -s "$OUT/pebble.minica.pem" && echo present || echo MISSING), pebble root $(test -s "$OUT/pebble-root.pem" && echo present || echo MISSING)"
  info "diag: caddy can reach pebble" "$(dc exec -T caddy wget -q -O /dev/null https://pebble:14000/dir 2>&1 | head -1 || true) exit=$?"
  caddy_logs | grep -iE 'error|obtain|acme|challenge|tls' | grep -v '"level":"info".*"msg":"handled request"' | tail -6 | while read -r l; do info "diag: caddy" "$(echo "$l" | sed -E 's/^[^|]*\| //' | cut -c1-220)"; done
  dc logs --no-color pebble 2>/dev/null | tail -5 | while read -r l; do info "diag: pebble" "$(echo "$l" | sed -E 's/^[^|]*\| //' | cut -c1-220)"; done
  dc logs --no-color challtestsrv 2>/dev/null | head -3 | while read -r l; do info "diag: challtestsrv" "$(echo "$l" | sed -E 's/^[^|]*\| //' | cut -c1-220)"; done
  info "diag: containers" "$(dc ps --format '{{.Service}}={{.State}}' | tr '\n' ' ')"
}

echo "=== 4. fixed GarnishTable hostnames (certificates from the ACME CA, verified by clients)"
for h in "${HOSTS[@]}"; do
  # The API has no root route (404 at "/"); probe its liveness endpoint instead.
  path=/; [ "$h" = "api.$BASE" ] && path=/health/live
  c=""; for i in $(seq 1 30); do c=$(code "$h" "$path"); [ "$c" = 200 ] && break; sleep 2; done
  issuer=$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$h" 2>/dev/null | openssl x509 -noout -issuer 2>/dev/null | sed 's/issuer=//')
  check "HTTPS $h (cert verified against the test CA)" "$c issuer=$issuer" test "$c" = 200
done
c=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --resolve "app.$BASE:80:127.0.0.1" "http://app.$BASE/login")
if [ "$(code "app.$BASE" /)" != 200 ]; then
  diag
  fail "Fixed hostnames obtained certificates" "no — stopping early; see diag lines (everything after depends on HTTPS)"
  exit 1
fi
check "HTTP → HTTPS redirect on a fixed hostname" "$c" sh -c "echo '$c' | grep -qE '^30[18] https://app.$BASE/login'"
check "Storefront deep link order.$BASE/r/demo-restaurant" "$(code "order.$BASE" /r/demo-restaurant)" test "$(code "order.$BASE" /r/demo-restaurant)" = 200
check "POS deep link pos.$BASE/pos" "$(code "pos.$BASE" /pos)" test "$(code "pos.$BASE" /pos)" = 200
ready=$(hc "api.$BASE" /health)
check "API readiness via api.$BASE/health" "$ready" sh -c "echo \"\$0\" | grep -q '\"mongo\":\"up\",\"redis\":\"up\"'" "$ready"
check "The ask endpoint is not reachable through the public API" "$(code "api.$BASE" "/internal/tls/ask?domain=$DOMAIN")" test "$(code "api.$BASE" "/internal/tls/ask?domain=$DOMAIN")" = 404

echo "=== 5. tenant data: plan catalog, demo restaurant, an owner account"
dc exec -T api node dist/scripts/seed.js > /dev/null 2>&1 && pass "Deploy step: seed.js" "exit 0" || fail "Deploy step: seed.js" "failed"
prov=$(dc exec -T api node dist/scripts/provisionProductionDemo.js 2>&1 | grep -o 'Created: .*')
check "Deploy step: provisionProductionDemo.js" "$prov" sh -c "echo '$prov' | grep -q '\"restaurant\":true'"
RID=$(dc exec -T mongo mongosh gt_edge_test --quiet --eval 'db.restaurants.findOne({slug:"demo-restaurant"})._id.toString()')
BID=$(dc exec -T mongo mongosh gt_edge_test --quiet --eval 'db.restaurants.findOne({slug:"demo-restaurant"}).businessId.toString()')
HASH=$(dc exec -T api node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" "$OWNER_PW")
dc exec -T mongo mongosh gt_edge_test --quiet --eval "db.users.insertOne({name:'Edge Test Owner',email:'edge-owner@$BASE',passwordHash:'$HASH',role:'restaurant_owner',restaurantId:ObjectId('$RID'),businessId:ObjectId('$BID'),emailVerifiedAt:new Date(),createdAt:new Date(),updatedAt:new Date()})" > /dev/null
OWNER_TOKEN=$(hc "app.$BASE" /api/v1/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"edge-owner@$BASE\",\"password\":\"$OWNER_PW\"}" | jq -r '.data.accessToken')
check "Owner signs in through app.$BASE" "token ${#OWNER_TOKEN} chars" test "${#OWNER_TOKEN}" -gt 20
sub=$(api POST "/businesses/$BID/subscription" '{"planCode":"owner_growth","billingInterval":"monthly"}' | jq -r '.data.subscription.status')
check "Owner starts a Growth trial (custom_domains entitlement)" "status=$sub" test "$sub" = trialing

echo "=== 6. custom domain lifecycle: add → DNS TXT → verify → activate"
check "Before anything: ask DENIES $DOMAIN" "$(ask $DOMAIN)" test "$(ask $DOMAIN)" = 403
add=$(api POST "/restaurants/$RID/domains" "{\"hostname\":\"Orders.Wildwood-Kitchen.example.\"}")
MID=$(echo "$add" | jq -r '.data.domain.id'); TOKEN_TXT=$(echo "$add" | jq -r '.data.domain.verificationToken'); stored=$(echo "$add" | jq -r '.data.domain.hostname')
check "Domain added (uppercase + trailing dot normalized)" "stored=$stored status=$(echo "$add" | jq -r '.data.domain.status')" test "$stored" = "$DOMAIN"
check "Pending domain: ask DENIES" "$(ask $DOMAIN)" test "$(ask $DOMAIN)" = 403
hc "$DOMAIN" / -o /dev/null 2>/dev/null; check "Pending domain: no certificate is issued (TLS handshake refused)" "curl exit $?" test "$(hc "$DOMAIN" / -o /dev/null > /dev/null 2>&1; echo $?)" -ne 0
# The restaurant publishes the TXT record at their DNS provider (here: the DNS test server).
curl -s -X POST http://127.0.0.1:8055/set-txt -d "{\"host\":\"_garnishtable-verify.$DOMAIN.\",\"value\":\"$TOKEN_TXT\"}" > /dev/null
ver=$(api POST "/restaurants/$RID/domains/$MID/check-verification" | jq -r '.data.verified')
check "Real DNS TXT verification (NodeDnsVerifier via DNS)" "verified=$ver" test "$ver" = true
check "Verified but inactive: ask DENIES" "$(ask $DOMAIN)" test "$(ask $DOMAIN)" = 403
act=$(api POST "/restaurants/$RID/domains/$MID/activate" | jq -r '.data.domain.status')
check "Domain activated" "status=$act" test "$act" = active
check "Active domain: ask ALLOWS" "$(ask $DOMAIN)" test "$(ask $DOMAIN)" = 200
routing=$(api GET "/businesses/$BID/domains" | jq -c '.data.routing')
check "Admin panel receives the CNAME target" "$routing" sh -c "echo '$routing' | grep -q '\"servingAvailable\":true,\"cnameTarget\":\"domains.$BASE\"'"

echo "=== 7. first HTTPS visit: on-demand certificate issued by the ACME CA"
c=""; for i in $(seq 1 30); do c=$(code "$DOMAIN" /); [ "$c" = 200 ] && break; sleep 2; done
CERT_INFO=$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -subject -issuer -enddate -ext subjectAltName 2>/dev/null | tr '\n' ' ')
check "HTTPS $DOMAIN served with a verified on-demand certificate" "$c $CERT_INFO" test "$c" = 200
SERIAL1=$(serial "$DOMAIN"); info "Initial certificate serial" "$SERIAL1"
echo "=== 7b. certificate persistence across a Caddy restart"
obtained_before=$(caddy_logs | grep -c "certificate obtained successfully")
dc restart caddy > /dev/null 2>&1
for i in $(seq 1 60); do [ "$(code "$DOMAIN" /)" = 200 ] && break; sleep 2; done
SERIAL_R=$(serial "$DOMAIN"); obtained_after=$(caddy_logs | grep -c "certificate obtained successfully")
check "Certificate reused after restart (no re-issuance)" "serial $SERIAL1 → $SERIAL_R" test -n "$SERIAL_R" -a "$SERIAL_R" = "$SERIAL1"
info "Caddy 'certificate obtained' log lines" "before restart $obtained_before, after $obtained_after (logs include the new container's)"

bd=$(hc "$DOMAIN" "/api/v1/restaurants/by-domain/$DOMAIN" | jq -r '.data.restaurant.slug')
check "Tenant resolution through the custom domain" "slug=$bd" test "$bd" = demo-restaurant
for p in / /cart /orders/000000000000000000000000 /account /login /loyalty; do
  check "Custom-domain deep link $p (SPA fallback through the edge)" "$(code "$DOMAIN" "$p")" test "$(code "$DOMAIN" "$p")" = 200
done
check "Custom-domain API request (/api via the storefront)" "$(code "$DOMAIN" /api/v1/public/plans)" test "$(code "$DOMAIN" /api/v1/public/plans)" = 200
check "Custom-domain /sitemap.xml" "$(code "$DOMAIN" /sitemap.xml)" test "$(code "$DOMAIN" /sitemap.xml)" = 200
c=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/cart")
check "HTTP → HTTPS redirect on the custom domain" "$c" sh -c "echo '$c' | grep -qE '^30[18] https://$DOMAIN/cart'"

if command -v google-chrome > /dev/null; then
  dom() { timeout 60 google-chrome --headless=new --no-sandbox --disable-gpu --ignore-certificate-errors --host-resolver-rules="MAP * 127.0.0.1" --virtual-time-budget=20000 --dump-dom "$1" 2>/dev/null; }
  page=$(dom "https://$DOMAIN/")
  check "Browser: custom domain renders the correct restaurant" "$(echo "$page" | grep -o 'Wildwood Kitchen' | head -1) / $(echo "$page" | grep -o 'Margherita Pizza' | head -1)" sh -c "echo \"\$0\" | grep -q 'Wildwood Kitchen' && echo \"\$0\" | grep -q 'Margherita Pizza'" "$page"
  page=$(dom "https://$DOMAIN/cart")
  check "Browser: custom-domain deep link /cart renders" "$(echo "$page" | grep -oiE 'your (cart|order)|cart' | head -1)" sh -c "echo \"\$0\" | grep -qi 'cart'" "$page"
else
  info "Browser checks" "skipped: google-chrome not installed"
fi

echo "=== 8. Socket.IO through the edge from the custom domain"
DEMO_TOKEN=$(hc "$DOMAIN" /api/v1/auth/demo-session -X POST | jq -r '.data.accessToken')
ITEM=$(hc "$DOMAIN" "/api/v1/restaurants/$RID/menu" | jq -r '[.. | objects | select(.name? == "San Pellegrino Sparkling Water") | (.id // ._id)][0]')
info "Customer demo session + menu item" "token ${#DEMO_TOKEN} chars, item=$ITEM"
sock() {
  docker run --rm --network garnishtable_edge \
    $(for h in "${HOSTS[@]}" "$DOMAIN" "$OTHER"; do printf -- '--add-host %s:%s ' "$h" "$CADDY_IP"; done) \
    -v "$PROD/test:/gt-test:ro" -e NODE_EXTRA_CA_CERTS=/gt-test/out/pebble-root.pem -e NODE_PATH=/repo/node_modules \
    garnishtable/api:edge-test node /gt-test/socket-check.cjs "$@"
}
live=$(sock live "https://$DOMAIN" "https://api.$BASE" "$DEMO_TOKEN" "$RID" "$ITEM" 70 2>&1 | tail -1)
check "Socket.IO from the custom domain: connects, receives the order event, survives 70s" "$live" sh -c "echo '$live' | grep -q '\"ok\":true'"
rej=$(sock reject "https://evil.example" "https://api.$BASE" "$DEMO_TOKEN" 2>&1 | tail -1)
check "Socket.IO from an unauthorized origin is rejected (polling + websocket)" "$rej" sh -c "echo '$rej' | grep -q '\"ok\":true'"
fixed=$(sock live "https://order.$BASE" "https://api.$BASE" "$DEMO_TOKEN" "$RID" "$ITEM" 5 2>&1 | tail -1)
check "Socket.IO from the fixed storefront hostname" "$fixed" sh -c "echo '$fixed' | grep -q '\"ok\":true'"

echo "=== 9. unauthorized hostnames"
api POST "/restaurants/$RID/domains" "{\"hostname\":\"$OTHER\"}" > /dev/null
check "Verified-only/pending second domain: ask DENIES" "$(ask $OTHER)" test "$(ask $OTHER)" = 403
for h in "$UNKNOWN" "$OTHER"; do
  r=$(hc "$h" / -o /dev/null 2>&1; echo "exit=$?")
  check "No certificate for $h (TLS refused, no tenant served)" "$(echo "$r" | tail -1)" sh -c "echo '$r' | tail -1 | grep -qv 'exit=0'"
done
for h in localhost 127.0.0.1 "api.internal" "bad_host.example" "app.$BASE" "domains.$BASE"; do
  check "ask DENIES '$h'" "$(ask "$h")" test "$(ask "$h")" = 403
done
stored=$(dc exec -T caddy sh -c 'ls -R /data/caddy/certificates 2>/dev/null' | grep -cE "^$UNKNOWN|/$UNKNOWN:" || true)
check "No certificate stored for the unknown hostname" "$stored entries" test "$stored" -eq 0
check "Denials are logged by the API" "$(api_logs | grep -c 'certificate denied') log lines" sh -c "[ $(api_logs | grep -c 'certificate denied') -gt 0 ]"
r=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: bad_host' http://127.0.0.1/)
check "Malformed Host header over HTTP is answered without serving content" "$r" sh -c "[ '$r' != 200 ]"
r=$(curl -sk -o /dev/null -w '%{http_code}' https://127.0.0.1/ 2>&1; echo " exit=$?")
check "HTTPS to the bare IP (no SNI) gets no certificate" "$r" sh -c "echo '$r' | grep -qv 'exit=0'"

echo "=== 10. private network exposure"
for p in 4000 4001 6379 27017; do
  r=$(curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$p/" ; echo $?)
  check "Port $p not reachable from the host" "curl exit $r" test "$r" -ne 0
done
pub=$(docker ps --format '{{.Names}} {{.Ports}}' | grep garnishtable | grep -v caddy | grep -E '0\.0\.0\.0|:::' | grep -vE 'challtestsrv|pebble' || true)
check "Only Caddy publishes ports (test CA services aside)" "${pub:-none}" test -z "$pub"

echo "=== 12. automatic renewal (test CA issues 240s certificates)"
SERIAL2=""
ALLOW_BEFORE=$(api_logs | grep -c 'certificate allowed')
for i in $(seq 1 30); do sleep 10; s=$(serial "$DOMAIN"); if [ -n "$s" ] && [ "$s" != "$SERIAL1" ]; then SERIAL2=$s; break; fi; done
check "Caddy renewed the custom-domain certificate automatically" "serial $SERIAL1 → ${SERIAL2:-unchanged}" test -n "$SERIAL2"
ALLOW_AFTER=$(api_logs | grep -c 'certificate allowed')
check "Renewal consulted the ask endpoint" "allow decisions $ALLOW_BEFORE → $ALLOW_AFTER during the renewal window" test "$ALLOW_AFTER" -gt "$ALLOW_BEFORE"
check "Storefront still served after renewal" "$(code "$DOMAIN" /)" test "$(code "$DOMAIN" /)" = 200

echo "=== 13. deactivation"
deact=$(api POST "/restaurants/$RID/domains/$MID/deactivate" | jq -r '.data.domain.status')
check "Domain deactivated" "status=$deact" test "$deact" = verified
check "Deactivated: ask DENIES (no new certificate, no renewal)" "$(ask $DOMAIN)" test "$(ask $DOMAIN)" = 403
bd=$(hc "$DOMAIN" "/api/v1/restaurants/by-domain/$DOMAIN" -o /dev/null -w '%{http_code}' 2>/dev/null || echo tls-refused)
check "Deactivated: the application stops serving the tenant on that hostname" "by-domain → $bd" sh -c "[ '$bd' != 200 ]"
sleep 61  # socket origin cache TTL
rej=$(sock reject "https://$DOMAIN" "https://api.$BASE" "$DEMO_TOKEN" 2>&1 | tail -1)
check "Deactivated: Socket.IO from that origin is rejected" "$rej" sh -c "echo '$rej' | grep -q '\"ok\":true'"
SERIAL_D=$(serial "$DOMAIN"); sleep 150; SERIAL_E=$(serial "$DOMAIN")
check "Deactivated: Caddy could not renew (certificate not replaced)" "serial $SERIAL_D → ${SERIAL_E:-none served}" sh -c "[ '$SERIAL_E' = '$SERIAL_D' ] || [ -z '$SERIAL_E' ]"
info "Caddy renewal errors after deactivation" "$(caddy_logs | grep -ciE "not allowed|decision|denied|403" ) matching log lines"

echo "=== 14. controlled failure behaviour"
dc stop web > /dev/null 2>&1
r=$(hc "order.$BASE" / -o "$OUT/err.txt" -w '%{http_code}' 2>/dev/null)
check "Storefront down: edge answers 502 without internal details" "$r body=$(head -c 80 "$OUT/err.txt" | tr -d '\n')" sh -c "[ '$r' = 502 ] && ! grep -qiE 'web:80|dial|172\\.30' '$OUT/err.txt'"
dc start web > /dev/null 2>&1
dc stop api > /dev/null 2>&1
r=$(hc "api.$BASE" /health -o "$OUT/err.txt" -w '%{http_code}' 2>/dev/null)
check "API down: edge answers 502 without internal details" "$r" sh -c "[ '$r' = 502 ] && ! grep -qiE 'api:4000|dial|172\\.30' '$OUT/err.txt'"
r=$(dc exec -T caddy wget -q -S -O /dev/null "http://api:4001/internal/tls/ask?domain=$DOMAIN" 2>&1 | tail -2 | tr '\n' ' ')
check "API down: the ask check fails closed (no certificate decision possible)" "$r" sh -c "echo '$r' | grep -qv ' 200 '"
dc start api > /dev/null 2>&1
for i in $(seq 1 60); do [ "$(code "api.$BASE" /health)" = 200 ] && break; sleep 2; done
check "API recovers after restart" "$(code "api.$BASE" /health)" test "$(code "api.$BASE" /health)" = 200

echo "=== 15. graceful shutdown of the whole stack"
dc stop -t 20 > /dev/null 2>&1
ex=$(docker inspect -f '{{.State.ExitCode}}' "$(dc ps -aq api)")
check "API exits cleanly on stop" "exit=$ex" test "$ex" = 0

echo
P=$(grep -c '^PASS' "$RESULTS" || true); F=$(grep -c '^FAIL' "$RESULTS" || true)
echo "=== RESULT: $P passed, $F failed"
[ "$F" -eq 0 ]
