# Orchestration

You have access to orchestration tools via MCP (from "claude-mgr-orchestrator"):
- `create_agent` — create a new sub-agent (provide a descriptive `name`)
- `delegate_task` — start an agent, wait for completion, return output (primary tool)
- `list_agents` — list agents in your workspace
- `send_message` — send input to a waiting agent
- `wait_for_agent` — long-poll until an agent finishes

You can create sub-agents to parallelize work. Use `delegate_task` for the standard pattern.
