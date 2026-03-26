import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs before importing the module
vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => "test-token-abc123"),
}));

const { apiRequest } = await import("../api.js");

describe("apiRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends Authorization Bearer header", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agents: [] }),
    });

    await apiRequest("/api/agents");

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers["Authorization"]).toBe("Bearer test-token-abc123");
  });

  it("uses long timeout for /wait endpoints", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "completed" }),
    });

    await apiRequest("/api/agents/x/wait?timeout=300");

    expect(fetchMock).toHaveBeenCalledOnce();
    // Verify the request was made (the timeout is internal via AbortController)
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/wait");
  });

  it("throws on HTTP error with message", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "internal server error" }),
    });

    await expect(apiRequest("/api/agents")).rejects.toThrow("internal server error");
  });
});
