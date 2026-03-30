import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../utils/api.js";

export function registerSymbolLookupTool(server: McpServer): void {
  server.tool(
    "dorotoring_symbol_lookup",
    "Jump-to-definition and find-references for a symbol. Like a LSP but for agents. Use 'definition' to find where a symbol is defined, 'references' to find all files that import/use it.",
    {
      symbol: z.string().describe("Symbol name to look up"),
      action: z.enum(["definition", "references"]).describe("What to find"),
      project: z.string().optional().describe("Project root path"),
    },
    async ({ symbol, action, project }) => {
      const params = new URLSearchParams({ symbol });
      if (project) params.set("project", project);
      const data = await apiRequest(`/api/code/references?${params}`) as any;
      if (action === "definition") {
        return { content: [{ type: "text", text: JSON.stringify({ definition: data.definition }) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  );
}
