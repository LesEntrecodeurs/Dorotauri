import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../utils/api.js";

export function registerOutlineTool(server: McpServer): void {
  server.tool(
    "dorotoring_file_outline",
    "Get the skeleton of a file: function signatures, class definitions, types, exports — without the implementation code. Use this instead of reading a full file when you only need to know what's defined. Returns ~90% fewer tokens than reading the whole file.",
    {
      path: z.string().describe("Absolute path to the file"),
    },
    async ({ path }) => {
      const data = await apiRequest(`/api/code/outline?file=${encodeURIComponent(path)}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  );
}
