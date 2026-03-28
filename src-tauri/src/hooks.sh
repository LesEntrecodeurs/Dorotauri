#!/bin/bash
# Dorotoring hooks script — called by Claude Code hooks to report agent status.
# Usage: hooks.sh <status>   (e.g. "running", "completed")
# Requires DOROTORING_AGENT_ID in the environment (set by Dorotoring before launching the agent).

STATUS="$1"
AGENT_ID="$DOROTORING_AGENT_ID"
API_URL="${CLAUDE_MGR_API_URL:-http://127.0.0.1:31415}"

# Not a Dorotoring-managed agent — nothing to do
[ -z "$AGENT_ID" ] && exit 0

# Resolve project root: prefer git root, fall back to $PWD
CWD=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")

# Fire-and-forget POST to the status hook endpoint (no auth required)
curl -s -o /dev/null -X POST "$API_URL/api/hooks/status" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_ID\",\"status\":\"$STATUS\",\"cwd\":\"$CWD\"}" &
