#!/usr/bin/env bash
# Test that hooks.sh correctly reports agent status to the Dorotoring API.
# Requires: Dorotoring app running (API on :31415)
set -euo pipefail

API="http://127.0.0.1:31415"
TOKEN=$(cat ~/.dorotoring/api-token 2>/dev/null || echo "")
AUTH="Authorization: Bearer $TOKEN"
HOOKS_SCRIPT="$HOME/.dorotoring/hooks.sh"
AGENT_ID=""
PASS=0
FAIL=0

ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

cleanup() {
    [ -n "$AGENT_ID" ] && curl -s -X DELETE -H "$AUTH" "$API/api/agents/$AGENT_ID" > /dev/null 2>&1 || true
    echo ""
    echo "=== Results: $PASS passed, $FAIL failed ==="
    [ "$FAIL" -eq 0 ] && exit 0 || exit 1
}
trap cleanup EXIT

echo "=== hooks.sh Test ==="

# Pre-flight: check API and hooks.sh
HEALTH=$(curl -s --connect-timeout 3 "$API/api/health" 2>/dev/null || echo "UNREACHABLE")
if ! echo "$HEALTH" | grep -q '"ok"'; then
    echo "  SKIP: API not reachable (is Dorotoring running?)"
    echo "=== Results: SKIPPED ==="
    exit 0
fi

if [ ! -x "$HOOKS_SCRIPT" ]; then
    fail "hooks.sh not found or not executable at $HOOKS_SCRIPT"
    exit 1
fi
ok "hooks.sh exists and is executable"

# Create a temporary agent
RESP=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"hooks-test","cwd":"/tmp"}' "$API/api/agents")
AGENT_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['id'])")
echo "  Created test agent: $AGENT_ID"

# Export the agent ID like Dorotoring does before launching an agent
export DOROTORING_AGENT_ID="$AGENT_ID"

# Call hooks.sh with "running"
"$HOOKS_SCRIPT" running
sleep 1

STATE=$(curl -s -H "$AUTH" "$API/api/agents/$AGENT_ID" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['processState'])")
[ "$STATE" = "running" ] && ok "hooks.sh running -> processState=running" || fail "expected running, got $STATE"

# Call hooks.sh with "completed"
"$HOOKS_SCRIPT" completed
sleep 1

STATE=$(curl -s -H "$AUTH" "$API/api/agents/$AGENT_ID" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['processState'])")
[ "$STATE" = "completed" ] && ok "hooks.sh completed -> processState=completed" || fail "expected completed, got $STATE"

# Test with no DOROTORING_AGENT_ID — should be a no-op
unset DOROTORING_AGENT_ID
"$HOOKS_SCRIPT" running 2>/dev/null
ok "hooks.sh exits cleanly without DOROTORING_AGENT_ID"

echo ""
echo "=== hooks.sh tests complete ==="
