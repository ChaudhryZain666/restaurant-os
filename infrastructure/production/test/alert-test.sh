#!/usr/bin/env bash
# Phase 89 — tests for lib.sh's alert(): JSON vs ntfy formats, the optional token, and that delivery
# problems never fail the caller. Talks only to a throwaway HTTP capture server on 127.0.0.1 (Node),
# never to a real alert endpoint. Run: bash infrastructure/production/test/alert-test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
SERVER_PID=""
cleanup() { [ -z "$SERVER_PID" ] || kill "$SERVER_PID" 2> /dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

CAPTURE="$WORK/requests.jsonl"
PORT_FILE="$WORK/port"
: > "$CAPTURE"

# Records each request as one JSON line {method, url, headers, body} and answers 200.
node -e '
  const http = require("http"), fs = require("fs");
  const [capture, portFile] = process.argv.slice(1);
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      fs.appendFileSync(capture, JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }) + "\n");
      res.end("ok");
    });
  });
  server.listen(0, "127.0.0.1", () => fs.writeFileSync(portFile, String(server.address().port)));
' "$CAPTURE" "$PORT_FILE" &
SERVER_PID=$!
for _ in $(seq 1 50); do [ -s "$PORT_FILE" ] && break; sleep 0.1; done
[ -s "$PORT_FILE" ] || { echo "FAIL capture server did not start"; exit 1; }
URL="http://127.0.0.1:$(cat "$PORT_FILE")/gt-alerts"

export GT_ROOT="$WORK/root" GT_EDGE_ENV="$WORK/edge.env"
# shellcheck source=../scripts/lib.sh
. "$HERE/../scripts/lib.sh"
set +e

failures=0
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; failures=$((failures + 1)); }
requests() { grep -c . "$CAPTURE" || true; }
last() { tail -1 "$CAPTURE" | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const r=JSON.parse(s);const v=$1;process.stdout.write(typeof v==='string'?v:JSON.stringify(v))})"; }

MESSAGE='deploy failed: "quoted" back\slash
second line'

# 1. No ALERT_WEBHOOK_URL → nothing is sent, and alert() still succeeds.
: > "$GT_EDGE_ENV"
before=$(requests)
if alert "nothing configured" && [ "$(requests)" = "$before" ]; then pass "no URL: nothing sent"; else fail "no URL: a request was sent or alert() failed"; fi

# 2. Default (json) → a valid JSON body whose text/content carry the whole message.
printf 'ALERT_WEBHOOK_URL=%s\n' "$URL" > "$GT_EDGE_ENV"
alert "$MESSAGE"
if [ "$(last 'r.headers["content-type"]')" = "application/json" ] \
  && [ "$(last 'JSON.parse(r.body).text.includes("\"quoted\" back\\slash second line")')" = "true" ] \
  && [ "$(last 'JSON.parse(r.body).text === JSON.parse(r.body).content')" = "true" ]; then
  pass "json: valid JSON with quote, backslash and newline preserved"
else
  fail "json: body was not the expected valid JSON ($(last 'r.body'))"
fi

# 3. ntfy → a plain-text body (no JSON) with a Title header.
printf 'ALERT_WEBHOOK_URL=%s\nALERT_WEBHOOK_FORMAT=ntfy\n' "$URL" > "$GT_EDGE_ENV"
alert "$MESSAGE"
if [ "$(last 'r.body.startsWith("[garnishtable ") && r.body.includes("second line") && !r.body.trim().startsWith("{")')" = "true" ] \
  && [ "$(last 'r.headers.title.startsWith("GarnishTable alert")')" = "true" ] \
  && [ "$(last 'r.headers["content-type"] !== "application/json"')" = "true" ]; then
  pass "ntfy: plain-text body with a title"
else
  fail "ntfy: unexpected request ($(last 'r'))"
fi

# 4. A token is sent as a Bearer header — not in the URL, and never written to the log.
TOKEN="tk_test_$RANDOM$RANDOM"
printf 'ALERT_WEBHOOK_URL=%s\nALERT_WEBHOOK_FORMAT=ntfy\nALERT_WEBHOOK_TOKEN=%s\n' "$URL" "$TOKEN" > "$GT_EDGE_ENV"
log_out="$(alert "with token" 2>&1)"
if [ "$(last 'r.headers.authorization')" = "Bearer $TOKEN" ] && [ "$(last 'r.url')" = "/gt-alerts" ] && ! grep -q "$TOKEN" <<< "$log_out"; then
  pass "token: sent as Authorization: Bearer, not in the URL or log"
else
  fail "token: header/URL/log not as expected"
fi

# 5. An unreachable endpoint → alert() still succeeds and logs the failure (without the token).
kill "$SERVER_PID" 2> /dev/null; wait "$SERVER_PID" 2> /dev/null; SERVER_PID=""
log_out="$(alert "server is gone" 2>&1)"; status=$?
if [ "$status" -eq 0 ] && grep -q "alert delivery failed" <<< "$log_out" && ! grep -q "$TOKEN" <<< "$log_out"; then
  pass "unreachable: alert() returns 0 and logs 'alert delivery failed'"
else
  fail "unreachable: status $status, log: $log_out"
fi

if [ "$failures" -gt 0 ]; then echo "$failures alert test(s) failed"; exit 1; fi
echo "All alert tests passed"
