import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../utils/api.js";

export function registerRepoMapTool(server: McpServer): void {
  server.tool(
    "dorotoring_repo_map",
    "Get a structural map of the project codebase. Shows key symbols (functions, classes, types) ranked by importance with file locations and line numbers. Use this to understand the project structure without exploring files.",
    {
      project: z.string().optional().describe("Project root path (defaults to cwd)"),
      budget: z.number().optional().describe("Max tokens for the map (default 2048)"),
    },
    async ({ project, budget }) => {
      const params = new URLSearchParams();
      if (project) params.set("project", project);
      if (budget) params.set("budget", budget.toString());
      const data = await apiRequest(`/api/code/repo-map?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  );
}
