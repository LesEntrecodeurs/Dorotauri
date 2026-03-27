import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../utils/api.js";

/**
 * Register agent tools as thin HTTP proxies to the Rust backend.
 * Zero business logic — every tool is a single HTTP call.
 */
export function registerAgentProxy(server: McpServer): void {
  server.tool(
    "list_agents",
    "List all agents with their current status",
    { tabId: z.string().optional().describe("Filter by tab ID") },
    async ({ tabId }) => {
      const params = tabId ? `?tab_id=${tabId}` : "";
      const data = await apiRequest(`/api/agents${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "get_agent",
    "Get detailed information about an agent",
    { id: z.string().describe("Agent ID") },
    async ({ id }) => {
      const data = await apiRequest(`/api/agents/${id}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "create_agent",
    "Create a new agent",
    {
      name: z.string().optional().describe("Agent name"),
      cwd: z.string().describe("Working directory"),
      skills: z.array(z.string()).optional().describe("Skills to enable"),
      character: z.string().optional().describe("Visual character"),
      tabId: z.string().optional().describe("Tab to assign to"),
      provider: z.string().optional().describe("CLI provider (claude, gemini, codex)"),
    },
    async (args) => {
      const data = await apiRequest("/api/agents", "POST", args);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "start_agent",
    "Start an agent with a prompt",
    {
      id: z.string().describe("Agent ID"),
      prompt: z.string().describe("Prompt to send"),
      model: z.string().optional().describe("Model override"),
    },
    async ({ id, ...body }) => {
      const data = await apiRequest(`/api/agents/${id}/start`, "POST", body);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "stop_agent",
    "Stop a running agent",
    { id: z.string().describe("Agent ID") },
    async ({ id }) => {
      const data = await apiRequest(`/api/agents/${id}/stop`, "POST");
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "send_message",
    "Send a message to an agent's terminal. Auto-starts idle agents.",
    {
      id: z.string().describe("Agent ID"),
      message: z.string().describe("Message to send"),
    },
    async ({ id, message }) => {
      const data = await apiRequest(`/api/agents/${id}/message`, "POST", { message });
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "wait_for_agent",
    "Wait for an agent to reach a terminal state (completed, error, waiting)",
    {
      id: z.string().describe("Agent ID"),
      timeout: z.number().optional().default(300).describe("Timeout in seconds"),
    },
    async ({ id, timeout }) => {
      const data = await apiRequest(`/api/agents/${id}/wait?timeout=${timeout}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "delegate_task",
    "Delegate a task to an agent: start, wait for completion, return output. This is the primary tool for task delegation.",
    {
      id: z.string().describe("Agent ID"),
      prompt: z.string().describe("Task to delegate"),
      model: z.string().optional().describe("Model override"),
      timeoutSeconds: z.number().optional().default(300).describe("Timeout in seconds"),
    },
    async ({ id, prompt, model, timeoutSeconds }) => {
      const data = await apiRequest(`/api/agents/${id}/delegate`, "POST", {
        prompt,
        model,
        timeoutSeconds,
      });
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "remove_agent",
    "Permanently delete an agent",
    { id: z.string().describe("Agent ID") },
    async ({ id }) => {
      const data = await apiRequest(`/api/agents/${id}`, "DELETE");
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );
}
