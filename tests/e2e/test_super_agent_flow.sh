#!/usr/bin/env bash
# E2E test: Super Agent flow against live Dorotoring API
# Requires: Dorotoring app running (API on :31415)
set -euo pipefail

API="http://127.0.0.1:31415"
TOKEN=$(cat ~/.dorotoring/api-token)
AUTH="Authorization: Bearer $TOKEN"
PASS=0
FAIL=0
WORKER_ID=""
SUPER_ID=""

ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

cleanup() {
    echo ""
    echo "--- Cleanup ---"
    [ -n "$WORKER_ID" ] && curl -s -X DELETE -H "$AUTH" "$API/api/agents/$WORKER_ID" > /dev/null 2>&1 || true
    [ -n "$SUPER_ID" ]  && curl -s -X DELETE -H "$AUTH" "$API/api/agents/$SUPER_ID"  > /dev/null 2>&1 || true
    echo ""
    echo "=== Results: $PASS passed, $FAIL failed ==="
    [ "$FAIL" -eq 0 ] && exit 0 || exit 1
}
trap cleanup EXIT

echo "=== Super Agent E2E Test ==="
echo ""

# --- 1. Health check ---
echo "1. Health check"
HEALTH=$(curl -s --connect-timeout 3 "$API/api/health" 2>/dev/null || echo "UNREACHABLE")
if echo "$HEALTH" | grep -q '"ok"'; then
    ok "API healthy"
else
    echo "  SKIP: API not reachable at $API (is Dorotoring running?)"
    echo ""
    echo "=== Results: SKIPPED — API not available ==="
    WORKER_ID=""
    SUPER_ID=""
    exit 0
fi

# --- 2. Create worker agent ---
echo "2. Create worker agent"
WORKER_RESP=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"e2e-worker","cwd":"/tmp","isSuperAgent":false}' \
  "$API/api/agents")
WORKER_ID=$(echo "$WORKER_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['id'])" 2>/dev/null || echo "")
[ -n "$WORKER_ID" ] && ok "Created worker: $WORKER_ID" || fail "Create worker failed: $WORKER_RESP"

# --- 3. Create super agent ---
echo "3. Create super agent"
SUPER_RESP=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"e2e-super","cwd":"/tmp","isSuperAgent":true,"superAgentScope":"tab","tabId":"e2e-tab"}' \
  "$API/api/agents")
SUPER_ID=$(echo "$SUPER_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['id'])" 2>/dev/null || echo "")
IS_SUPER=$(echo "$SUPER_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['isSuperAgent'])" 2>/dev/null || echo "")
[ "$IS_SUPER" = "True" ] && ok "Super agent created with isSuperAgent=true" || fail "isSuperAgent not true: $SUPER_RESP"

# Check superAgentScope was saved
SCOPE=$(echo "$SUPER_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['agent'].get('superAgentScope','MISSING'))" 2>/dev/null || echo "MISSING")
[ "$SCOPE" = "tab" ] && ok "superAgentScope=tab saved" || fail "superAgentScope missing or wrong: $SCOPE"

# --- 4. Tab filtering ---
echo "4. Tab filtering"
TAB_RESP=$(curl -s -H "$AUTH" "$API/api/agents?tabId=e2e-tab")
TAB_COUNT=$(echo "$TAB_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['agents']))" 2>/dev/null || echo "0")
[ "$TAB_COUNT" -ge 1 ] && ok "Tab filter returns $TAB_COUNT agent(s)" || fail "Tab filter returned 0 agents"

ALL_RESP=$(curl -s -H "$AUTH" "$API/api/agents")
ALL_COUNT=$(echo "$ALL_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['agents']))" 2>/dev/null || echo "0")
[ "$ALL_COUNT" -ge 2 ] && ok "Unfiltered returns $ALL_COUNT agents (>= 2)" || fail "Unfiltered returned $ALL_COUNT agents"

# --- 5. Hook status lifecycle ---
echo "5. Hook status lifecycle"
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$WORKER_ID\",\"status\":\"running\"}" \
  "$API/api/hooks/status" > /dev/null

AGENT_STATE=$(curl -s -H "$AUTH" "$API/api/agents/$WORKER_ID" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['processState'])" 2>/dev/null || echo "")
[ "$AGENT_STATE" = "running" ] && ok "Hook set status to running" || fail "Expected running, got: $AGENT_STATE"

curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$WORKER_ID\",\"status\":\"completed\"}" \
  "$API/api/hooks/status" > /dev/null

AGENT_STATE=$(curl -s -H "$AUTH" "$API/api/agents/$WORKER_ID" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['processState'])" 2>/dev/null || echo "")
[ "$AGENT_STATE" = "completed" ] && ok "Hook set status to completed" || fail "Expected completed, got: $AGENT_STATE"

# --- 6. Wait broadcast ---
echo "6. Wait broadcast"
# Reset to running first
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$WORKER_ID\",\"status\":\"running\"}" \
  "$API/api/hooks/status" > /dev/null

# Start wait in background (5s timeout)
curl -s -H "$AUTH" "$API/api/agents/$WORKER_ID/wait?timeout=5" > /tmp/e2e-wait-result.json 2>&1 &
WAIT_PID=$!
sleep 1

# Trigger completion
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$WORKER_ID\",\"status\":\"completed\"}" \
  "$API/api/hooks/status" > /dev/null

# Wait for the background curl to finish
wait $WAIT_PID 2>/dev/null || true
WAIT_STATUS=$(python3 -c "import json; print(json.load(open('/tmp/e2e-wait-result.json'))['status'])" 2>/dev/null || echo "")
[ "$WAIT_STATUS" = "completed" ] && ok "Wait returned on broadcast" || fail "Wait returned: $WAIT_STATUS"
rm -f /tmp/e2e-wait-result.json

# --- 7. Cleanup handled by trap ---
echo "7. Cleanup"
