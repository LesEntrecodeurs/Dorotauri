#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAgentProxy } from "./tools/agents.js";
import { registerMessagingTools } from "./tools/messaging.js";
import { registerSchedulerTools } from "./tools/scheduler.js";
import { registerAutomationTools } from "./tools/automations.js";

const server = new McpServer({
  name: "dorotoring",
  version: "2.0.0",
});

// Core agent tools — thin proxy to Rust API
registerAgentProxy(server);

// Legacy tools — kept as-is for now (out of scope for rewrite)
registerMessagingTools(server);
registerSchedulerTools(server);
registerAutomationTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Dorotoring MCP proxy connected (stdio)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
