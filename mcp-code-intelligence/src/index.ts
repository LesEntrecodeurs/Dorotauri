import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRepoMapTool } from "./tools/repo-map.js";
import { registerOutlineTool } from "./tools/outline.js";
import { registerSymbolLookupTool } from "./tools/symbols.js";
import { registerRecallTool } from "./tools/search.js";

const server = new McpServer({
  name: "dorotoring-code-intel",
  version: "1.0.0",
});

registerRepoMapTool(server);
registerOutlineTool(server);
registerSymbolLookupTool(server);
registerRecallTool(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("dorotoring-code-intel MCP server connected (stdio)");
}

main().catch(console.error);
