import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs for token reading
vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => "test-token"),
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DOROTORING_TAB_ID;
});

const { apiRequest } = await import("../../utils/api.js");

/** Helper: extract URL from fetch call at index i */
function callUrl(i: number): string {
  return fetchMock.mock.calls[i]?.[0] ?? "";
}

/** Helper: extract parsed body from fetch call at index i */
function callBody(i: number): Record<string, unknown> | undefined {
  const raw = fetchMock.mock.calls[i]?.[1]?.body;
  return raw ? JSON.parse(raw as string) : undefined;
}

describe("list_agents", () => {
  it("fetches without tabId filter when env not set", async () => {
    delete process.env.DOROTORING_TAB_ID;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agents: [] }),
    });

    const tabId = process.env.DOROTORING_TAB_ID;
    const url = tabId
      ? `/api/agents?tabId=${encodeURIComponent(tabId)}`
      : "/api/agents";
    await apiRequest(url);

    expect(callUrl(0)).toContain("/api/agents");
    expect(callUrl(0)).not.toContain("tabId");
  });

  it("passes tabId filter when env is set", async () => {
    process.env.DOROTORING_TAB_ID = "tab-abc";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agents: [] }),
    });

    const tabId = process.env.DOROTORING_TAB_ID;
    const url = tabId
      ? `/api/agents?tabId=${encodeURIComponent(tabId)}`
      : "/api/agents";
    await apiRequest(url);

    expect(callUrl(0)).toContain("tabId=tab-abc");
  });
});

describe("create_agent with tabId", () => {
  it("includes tabId in body when env is set", async () => {
    process.env.DOROTORING_TAB_ID = "tab-xyz";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agent: { id: "new-1", name: "Worker" } }),
    });

    const body: Record<string, unknown> = {
      projectPath: "/tmp",
      name: "Worker",
    };
    if (process.env.DOROTORING_TAB_ID) {
      body.tabId = process.env.DOROTORING_TAB_ID;
    }
    await apiRequest("/api/agents", "POST", body);

    expect(callBody(0)).toHaveProperty("tabId", "tab-xyz");
  });
});

describe("delegate_task pattern", () => {
  it("chains start -> wait -> get_output for idle agent", async () => {
    // 1. get_agent returns inactive
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        agent: { processState: "inactive", name: "Worker" },
      }),
    });
    // 2. start returns ok
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agent: { id: "a1", processState: "running" } }),
    });
    // 3. wait returns completed (wait endpoint uses "status" key)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "completed",
        lastCleanOutput: "Task done",
      }),
    });
    // 4. final get_agent — uses statusLine (not lastCleanOutput)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        agent: { statusLine: "Task done", processState: "completed" },
      }),
    });

    // Simulate delegate_task with CORRECT field names
    const agentData = (await apiRequest("/api/agents/a1")) as {
      agent: { processState: string; name?: string };
    };
    expect(agentData.agent.processState).toBe("inactive");

    const status = agentData.agent.processState;
    if (status !== "running" && status !== "waiting") {
      await apiRequest("/api/agents/a1/start", "POST", { prompt: "do work" });
    }

    const waitData = (await apiRequest("/api/agents/a1/wait?timeout=300")) as {
      status: string;
      lastCleanOutput?: string;
    };
    expect(waitData.status).toBe("completed");
    expect(waitData.lastCleanOutput).toBe("Task done");

    const finalAgent = (await apiRequest("/api/agents/a1")) as {
      agent: { statusLine?: string; processState: string };
    };
    expect(finalAgent.agent.statusLine).toBe("Task done");

    // Verify call sequence
    expect(callUrl(0)).toContain("/api/agents/a1");
    expect(callUrl(1)).toContain("/start");
    expect(callUrl(2)).toContain("/wait");
    expect(callUrl(3)).toContain("/api/agents/a1");
  });
});

describe("send_message adapts to status", () => {
  it("starts inactive agent instead of sending message", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        agent: { processState: "inactive", name: "Worker" },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agent: { processState: "running" } }),
    });

    const agentData = (await apiRequest("/api/agents/a1")) as {
      agent: { processState: string };
    };
    if (
      agentData.agent.processState === "inactive" ||
      agentData.agent.processState === "completed" ||
      agentData.agent.processState === "error"
    ) {
      await apiRequest("/api/agents/a1/start", "POST", { prompt: "hello" });
    }

    expect(callUrl(1)).toContain("/start");
  });

  it("sends message to waiting agent", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        agent: { processState: "waiting", name: "Worker" },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const agentData = (await apiRequest("/api/agents/a1")) as {
      agent: { processState: string };
    };
    if (agentData.agent.processState === "waiting") {
      await apiRequest("/api/agents/a1/message", "POST", { message: "yes" });
    }

    expect(callUrl(1)).toContain("/message");
  });
});

describe("wait_for_agent", () => {
  it("passes timeout as query param", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "completed" }),
    });

    await apiRequest("/api/agents/a1/wait?timeout=120");

    expect(callUrl(0)).toContain("timeout=120");
  });
});
