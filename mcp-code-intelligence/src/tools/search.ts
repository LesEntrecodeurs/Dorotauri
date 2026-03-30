import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../utils/api.js";

export function registerRecallTool(server: McpServer): void {
  server.tool(
    "dorotoring_recall",
    "Search across all project knowledge: code symbols, past agent sessions, and Claude Code memories. Uses hybrid text + semantic search. Returns results ranked by relevance.",
    {
      query: z.string().describe("Search query (natural language or symbol name)"),
      project: z.string().optional().describe("Project root path"),
      type: z.enum(["all", "symbol", "session", "claude_memory"]).optional().describe("Filter by knowledge type"),
      max_results: z.number().optional().describe("Max results (default 10)"),
    },
    async ({ query, project, type: sourceType, max_results }) => {
      const params = new URLSearchParams({ query });
      if (project) params.set("project", project);
      if (sourceType) params.set("type", sourceType);
      if (max_results) params.set("max_results", max_results.toString());
      const data = await apiRequest(`/api/knowledge/search?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  );
}
