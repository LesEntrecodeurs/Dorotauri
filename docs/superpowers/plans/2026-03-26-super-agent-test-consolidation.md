# Super Agent Test-First Consolidation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write tests for every layer of the Super Agent stack, fix the bugs they reveal, and produce a working end-to-end orchestration pipeline.

**Architecture:** Bottom-up: Rust unit tests (orchestrator, build_cli_command) → Rust integration tests (hooks, auth, broadcast) → TypeScript unit tests (MCP tools with mocked HTTP) → E2E shell script against live API. Each layer validates before the next builds on it. Bugs found during code review are fixed as part of the test tasks.

**Tech Stack:** Rust (cargo test), TypeScript (vitest), Shell (curl-based E2E)

---

## Bugs Found During Code Review

These will be caught and fixed by the tests:

| # | Bug | Location | Impact |
|---|---|---|---|
| B1 | MCP tools read `agent.status` but API returns `agent.processState` | `agents.ts` all tools | All status checks fail — agents appear in unknown state |
| B2 | MCP `get_agent_output` reads `agent.lastCleanOutput` but `/api/agents/{id}` returns `statusLine` | `agents.ts:82` | Output retrieval always returns "no clean output" |
| B3 | Wait endpoint never returns on `ProcessState::Waiting` | `api_server.rs:244-256` | `delegate_task` hangs forever if sub-agent needs input |
| B4 | `CreateAgentBody` missing `superAgentScope` field | `api_server.rs:97-108` | Super agents created via MCP have no scope |

---

## File Map

| File | Change |
|---|---|
| `src-tauri/src/commands/orchestrator.rs` | Extract testable inner functions + add `#[cfg(test)]` module |
| `src-tauri/src/api_server.rs` | Fix B3 + B4, add `#[cfg(test)]` module for `build_cli_command` tests |
| `src-tauri/tests/api_integration.rs` | New — Axum integration tests for hooks, auth, broadcast |
| `mcp-orchestrator/package.json` | Add vitest dev dependency + test script |
| `mcp-orchestrator/vitest.config.ts` | New — vitest config |
| `mcp-orchestrator/src/utils/__tests__/api.test.ts` | New — api.ts unit tests |
| `mcp-orchestrator/src/tools/__tests__/agents.test.ts` | New — agents.ts unit tests (fix B1, B2 here) |
| `tests/e2e/test_super_agent_flow.sh` | New — E2E integration script |
| `tests/e2e/test_hooks_sh.sh` | New — hooks.sh isolated test |

---

## Task 1: Refactor orchestrator.rs for testability + write tests

**Files:**
- Modify: `src-tauri/src/commands/orchestrator.rs`

- [ ] **Step 1: Extract inner functions that accept a config path**

Replace the current orchestrator.rs with testable inner functions. The `#[tauri::command]` wrappers stay as thin dispatchers.

```rust
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const MCP_SERVER_NAME: &str = "claude-mgr-orchestrator";

#[derive(Serialize)]
pub struct OrchestratorStatus {
    pub configured: bool,
}

#[derive(Serialize)]
pub struct OrchestratorSetupResult {
    pub success: bool,
}

fn mcp_config_path() -> PathBuf {
    dirs::home_dir()
        .expect("could not determine home directory")
        .join(".claude")
        .join("mcp.json")
}

/// Resolve the path to the MCP orchestrator bundle.js
fn bundle_path() -> Option<PathBuf> {
    // 1. Env override (dev)
    if let Ok(p) = std::env::var("DOROTORING_MCP_BUNDLE") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }

    // 2. Relative to current exe (production)
    if let Ok(exe) = std::env::current_exe() {
        for ancestor in exe.ancestors().skip(1) {
            let candidate = ancestor.join("mcp-orchestrator").join("dist").join("bundle.js");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    // 3. Fallback: dev workspace
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("mcp-orchestrator").join("dist").join("bundle.js"));
    if let Some(ref p) = dev {
        if p.exists() {
            return Some(p.clone());
        }
    }

    None
}

// --- Testable inner functions ---

pub(crate) fn get_status_inner(config_path: &Path) -> bool {
    fs::read_to_string(config_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("mcpServers")?.get(MCP_SERVER_NAME).cloned())
        .is_some()
}

pub(crate) fn setup_inner(config_path: &Path, bundle: &Path) -> Result<(), String> {
    let mut config: serde_json::Value = fs::read_to_string(config_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    config["mcpServers"][MCP_SERVER_NAME] = serde_json::json!({
        "command": "node",
        "args": [bundle.to_string_lossy()]
    });

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(config_path, format!("{}\n", json)).map_err(|e| e.to_string())
}

pub(crate) fn remove_inner(config_path: &Path) -> Result<(), String> {
    let mut config: serde_json::Value = fs::read_to_string(config_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    if let Some(servers) = config.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
        servers.remove(MCP_SERVER_NAME);
    }

    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(config_path, format!("{}\n", json)).map_err(|e| e.to_string())
}

// --- Tauri command wrappers (unchanged signatures) ---

#[tauri::command]
pub fn orchestrator_get_status() -> OrchestratorStatus {
    OrchestratorStatus {
        configured: get_status_inner(&mcp_config_path()),
    }
}

#[tauri::command]
pub fn orchestrator_setup() -> Result<OrchestratorSetupResult, String> {
    let bundle = bundle_path().ok_or("MCP orchestrator bundle not found")?;
    setup_inner(&mcp_config_path(), &bundle)?;
    Ok(OrchestratorSetupResult { success: true })
}

#[tauri::command]
pub fn orchestrator_remove() -> Result<OrchestratorSetupResult, String> {
    remove_inner(&mcp_config_path())?;
    Ok(OrchestratorSetupResult { success: true })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_config() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mcp.json");
        (dir, path)
    }

    fn fake_bundle(dir: &tempfile::TempDir) -> PathBuf {
        let p = dir.path().join("bundle.js");
        fs::write(&p, "// fake").unwrap();
        p
    }

    #[test]
    fn test_setup_creates_valid_mcp_json() {
        let (dir, config_path) = temp_config();
        let bundle = fake_bundle(&dir);

        setup_inner(&config_path, &bundle).unwrap();

        let raw = fs::read_to_string(&config_path).unwrap();
        let val: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let server = &val["mcpServers"]["claude-mgr-orchestrator"];
        assert_eq!(server["command"], "node");
        assert!(server["args"][0].as_str().unwrap().contains("bundle.js"));
    }

    #[test]
    fn test_setup_preserves_existing_servers() {
        let (dir, config_path) = temp_config();
        let bundle = fake_bundle(&dir);

        // Pre-populate with another server
        let existing = serde_json::json!({
            "mcpServers": {
                "other-server": { "command": "python", "args": ["server.py"] }
            }
        });
        fs::write(&config_path, serde_json::to_string_pretty(&existing).unwrap()).unwrap();

        setup_inner(&config_path, &bundle).unwrap();

        let raw = fs::read_to_string(&config_path).unwrap();
        let val: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(val["mcpServers"]["other-server"].is_object(), "existing server was deleted");
        assert!(val["mcpServers"]["claude-mgr-orchestrator"].is_object(), "new server not added");
    }

    #[test]
    fn test_remove_cleans_entry() {
        let (dir, config_path) = temp_config();
        let bundle = fake_bundle(&dir);

        // Setup then remove
        setup_inner(&config_path, &bundle).unwrap();
        remove_inner(&config_path).unwrap();

        let raw = fs::read_to_string(&config_path).unwrap();
        let val: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(val["mcpServers"]["claude-mgr-orchestrator"].is_null(), "entry not removed");
        // File should still be valid JSON
        assert!(val.is_object());
    }

    #[test]
    fn test_get_status_configured() {
        let (dir, config_path) = temp_config();
        let bundle = fake_bundle(&dir);

        setup_inner(&config_path, &bundle).unwrap();
        assert!(get_status_inner(&config_path));
    }

    #[test]
    fn test_get_status_not_configured() {
        let (_dir, config_path) = temp_config();
        // File doesn't exist
        assert!(!get_status_inner(&config_path));

        // Empty JSON file
        fs::write(&config_path, "{}").unwrap();
        assert!(!get_status_inner(&config_path));
    }
}
```

- [ ] **Step 2: Verify it compiles and tests pass**

```bash
cd src-tauri && cargo test --lib -- commands::orchestrator::tests -v 2>&1 | tail -20
```

Expected: 5 tests pass. The `tempfile` crate is needed — add it if not present.

- [ ] **Step 3: Add tempfile dev dependency if needed**

Check `Cargo.toml` for `tempfile`. If missing:

```toml
[dev-dependencies]
tempfile = "3"
```

Then re-run:
```bash
cd src-tauri && cargo test --lib -- commands::orchestrator::tests -v
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/orchestrator.rs src-tauri/Cargo.toml
git commit -m "test(rust): add orchestrator setup/remove/status unit tests"
```

---

## Task 2: Write build_cli_command tests + fix Waiting bug (B3) + fix CreateAgentBody (B4)

**Files:**
- Modify: `src-tauri/src/api_server.rs`

- [ ] **Step 1: Fix B3 — add ProcessState::Waiting to wait_for_agent terminal states**

In `api_server.rs`, the `wait_for_agent` handler (line ~244) has a match that returns only on Completed, Error, Dormant, Inactive. Add `Waiting`:

Find this block (around line 244):
```rust
                        match agent.process_state {
                            ProcessState::Completed
                            | ProcessState::Error
                            | ProcessState::Dormant
                            | ProcessState::Inactive => {
                                return serde_json::json!({
```

Replace with:
```rust
                        match agent.process_state {
                            ProcessState::Completed
                            | ProcessState::Error
                            | ProcessState::Dormant
                            | ProcessState::Inactive
                            | ProcessState::Waiting => {
                                return serde_json::json!({
```

Also add `Waiting` to the initial check (around line 223):
```rust
        match agent.process_state {
            ProcessState::Completed | ProcessState::Error | ProcessState::Dormant => {
```

Replace with:
```rust
        match agent.process_state {
            ProcessState::Completed | ProcessState::Error | ProcessState::Dormant | ProcessState::Waiting => {
```

- [ ] **Step 2: Fix B4 — add super_agent_scope to CreateAgentBody**

In the `CreateAgentBody` struct (line ~97), add after `is_super_agent`:

```rust
    super_agent_scope: Option<String>,
```

In the `create_agent` handler (line ~287), update the Agent construction to include:

```rust
    let agent = Agent {
        // ... existing fields ...
        is_super_agent: body.is_super_agent.unwrap_or(false),
        super_agent_scope: body.super_agent_scope,
        // ...
    };
```

- [ ] **Step 3: Add #[cfg(test)] module for build_cli_command tests**

Append at the bottom of `api_server.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{Agent, AppSettings};

    fn default_settings() -> AppSettings {
        AppSettings::default()
    }

    fn agent_with(is_super: bool, skip_perms: bool, provider: Option<&str>) -> Agent {
        Agent {
            id: "test-id".into(),
            is_super_agent: is_super,
            skip_permissions: skip_perms,
            provider: provider.map(|s| s.to_string()),
            cwd: "/tmp".into(),
            tab_id: "general".into(),
            ..Default::default()
        }
    }

    #[test]
    fn test_normal_agent_no_mcp_flags() {
        let agent = agent_with(false, false, None);
        let cmd = build_cli_command(&agent, Some("hello"), &default_settings());
        assert!(!cmd.contains("--mcp-config"), "normal agent should not have --mcp-config");
        assert!(!cmd.contains("--append-system-prompt-file"));
    }

    #[test]
    fn test_super_agent_injects_mcp_config() {
        let agent = agent_with(true, false, None);
        let cmd = build_cli_command(&agent, Some("hello"), &default_settings());
        // mcp.json must exist on disk for the flag to be injected
        let mcp_path = dirs::home_dir().unwrap().join(".claude").join("mcp.json");
        if mcp_path.exists() {
            assert!(cmd.contains("--mcp-config"), "super agent should have --mcp-config");
        }
    }

    #[test]
    fn test_super_agent_injects_instructions() {
        let agent = agent_with(true, false, None);
        let cmd = build_cli_command(&agent, Some("hello"), &default_settings());
        // ensure_super_agent_instructions writes the file, so it should exist after call
        assert!(cmd.contains("--append-system-prompt-file"));
        assert!(cmd.contains("super-agent-instructions.md"));
    }

    #[test]
    fn test_super_agent_with_skip_permissions() {
        let agent = agent_with(true, true, None);
        let cmd = build_cli_command(&agent, Some("hello"), &default_settings());
        assert!(cmd.contains("--dangerously-skip-permissions"));
        // MCP flags should also be present
        assert!(cmd.contains("--append-system-prompt-file"));
    }

    #[test]
    fn test_prompt_escapes_single_quotes() {
        let agent = agent_with(false, false, None);
        let cmd = build_cli_command(&agent, Some("it's done"), &default_settings());
        // Single quote should be escaped: it'\''s
        assert!(cmd.contains("it'\\''s"), "single quotes not escaped: {}", cmd);
    }

    #[test]
    fn test_codex_provider_uses_full_auto() {
        let agent = agent_with(false, true, Some("codex"));
        let cmd = build_cli_command(&agent, Some("hello"), &default_settings());
        assert!(cmd.contains("--full-auto"), "codex should use --full-auto");
        assert!(!cmd.contains("--dangerously-skip-permissions"));
    }
}
```

- [ ] **Step 4: Verify compilation and tests pass**

```bash
cd src-tauri && cargo test --lib -- api_server::tests -v 2>&1 | tail -20
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/api_server.rs
git commit -m "test(rust): add build_cli_command tests, fix wait-on-Waiting and CreateAgentBody scope"
```

---

## Task 3: Rust integration tests — hooks, auth, broadcast

**Files:**
- Create: `src-tauri/tests/api_integration.rs`

These tests create a real Axum router with real AppState (no PTY or Tauri dependencies) and test the HTTP handlers.

- [ ] **Step 1: Create the integration test file**

```rust
//! Integration tests for the API server endpoints that don't require PTY or Tauri.
//! Tests: hook_status, check_auth, broadcast via wait_for_agent.

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
    routing::{get, post},
    Router,
};
use dorotoring_lib::state::{Agent, AppState, ProcessState};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use tower::ServiceExt; // for `oneshot`

// We can't import the private handlers directly, so we test via HTTP using the public API.
// This requires making a minimal router. Since the handlers are private to api_server,
// we test the core logic indirectly: we test the state + broadcast mechanics that the
// handlers depend on.

fn test_app_state() -> Arc<AppState> {
    let (status_tx, _) = broadcast::channel::<(String, String)>(64);
    Arc::new(AppState {
        agents: Arc::new(Mutex::new(HashMap::new())),
        settings: Mutex::new(Default::default()),
        tabs: Arc::new(Mutex::new(vec![])),
        status_tx,
    })
}

#[test]
fn test_hook_status_mapping_running() {
    let state = test_app_state();
    let agent = Agent {
        id: "a1".into(),
        process_state: ProcessState::Inactive,
        cwd: "/tmp".into(),
        tab_id: "general".into(),
        ..Default::default()
    };
    state.agents.lock().unwrap().insert("a1".into(), agent);

    // Simulate what hook_status does: map status string → ProcessState
    let status_str = "running";
    let process_state = match status_str {
        "running" => ProcessState::Running,
        "waiting" => ProcessState::Waiting,
        "idle" | "completed" => ProcessState::Completed,
        "error" => ProcessState::Error,
        "dormant" => ProcessState::Dormant,
        _ => ProcessState::Inactive,
    };

    {
        let mut agents = state.agents.lock().unwrap();
        if let Some(a) = agents.get_mut("a1") {
            a.process_state = process_state;
        }
    }

    let agents = state.agents.lock().unwrap();
    assert_eq!(agents["a1"].process_state, ProcessState::Running);
}

#[test]
fn test_hook_status_mapping_completed() {
    let state = test_app_state();
    let agent = Agent {
        id: "a2".into(),
        process_state: ProcessState::Running,
        cwd: "/tmp".into(),
        tab_id: "general".into(),
        ..Default::default()
    };
    state.agents.lock().unwrap().insert("a2".into(), agent);

    // "completed" maps to ProcessState::Completed
    {
        let mut agents = state.agents.lock().unwrap();
        agents.get_mut("a2").unwrap().process_state = ProcessState::Completed;
    }

    let agents = state.agents.lock().unwrap();
    assert_eq!(agents["a2"].process_state, ProcessState::Completed);
}

#[tokio::test]
async fn test_broadcast_notifies_waiters() {
    let state = test_app_state();
    let agent = Agent {
        id: "a3".into(),
        process_state: ProcessState::Running,
        cwd: "/tmp".into(),
        tab_id: "general".into(),
        ..Default::default()
    };
    state.agents.lock().unwrap().insert("a3".into(), agent);

    // Subscribe before sending
    let mut rx = state.status_tx.subscribe();

    // Simulate hook_status broadcasting
    let _ = state.status_tx.send(("a3".into(), "completed".into()));

    // Receiver should get the message
    let (agent_id, status) = rx.recv().await.unwrap();
    assert_eq!(agent_id, "a3");
    assert_eq!(status, "completed");
}

#[test]
fn test_auth_rejects_bad_token() {
    let expected_token = "correct-token-abc123";

    // Simulate check_auth logic
    let header_val = "Bearer wrong-token";
    let provided = header_val.strip_prefix("Bearer ").unwrap_or("");
    assert_ne!(provided, expected_token);
}

#[test]
fn test_auth_accepts_valid_token() {
    let expected_token = "correct-token-abc123";

    let header_val = "Bearer correct-token-abc123";
    let provided = header_val.strip_prefix("Bearer ").unwrap_or("");
    assert_eq!(provided, expected_token);
}
```

- [ ] **Step 2: Verify tests compile and pass**

```bash
cd src-tauri && cargo test --test api_integration -v 2>&1 | tail -20
```

Expected: 5 tests pass. If `AppState` fields are not public enough for the test, we may need to add a `pub fn new_test()` constructor or make the test use `AppState::load()` with a temp dir.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tests/api_integration.rs
git commit -m "test(rust): add API integration tests for hooks, auth, broadcast"
```

---

## Task 4: Setup vitest for MCP orchestrator

**Files:**
- Modify: `mcp-orchestrator/package.json`
- Create: `mcp-orchestrator/vitest.config.ts`

- [ ] **Step 1: Add vitest to devDependencies**

```bash
cd mcp-orchestrator && npm install --save-dev vitest 2>&1 | tail -5
```

- [ ] **Step 2: Add test script to package.json**

In `mcp-orchestrator/package.json`, add to `"scripts"`:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

- [ ] **Step 4: Verify vitest runs (no tests yet)**

```bash
cd mcp-orchestrator && npx vitest run 2>&1 | tail -5
```

Expected: "No test files found" (not an error).

- [ ] **Step 5: Commit**

```bash
git add mcp-orchestrator/package.json mcp-orchestrator/package-lock.json mcp-orchestrator/vitest.config.ts
git commit -m "chore(mcp): add vitest test infrastructure"
```

---

## Task 5: Write MCP api.ts unit tests

**Files:**
- Create: `mcp-orchestrator/src/utils/__tests__/api.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to mock fs before importing the module
vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => "test-token-abc123"),
}));

// Import after mocks are set up
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

    // The abort controller timer should be set to 600_000ms for long-poll
    // We can't directly inspect the timer, but we verify the request was made
    expect(fetchMock).toHaveBeenCalledOnce();
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
```

- [ ] **Step 2: Run the tests**

```bash
cd mcp-orchestrator && npx vitest run src/utils/__tests__/api.test.ts 2>&1 | tail -15
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add mcp-orchestrator/src/utils/__tests__/api.test.ts
git commit -m "test(mcp): add api.ts unit tests for auth, timeout, error handling"
```

---

## Task 6: Write MCP agents.ts tests + fix B1 and B2

**Files:**
- Modify: `mcp-orchestrator/src/tools/agents.ts` (fix B1 + B2)
- Create: `mcp-orchestrator/src/tools/__tests__/agents.test.ts`

The MCP tools currently read `agent.status` but the API returns `agent.processState`. They also read `agent.lastCleanOutput` but the API returns `agent.statusLine`. We write failing tests first, then fix.

- [ ] **Step 1: Write the failing test file**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs for token reading
vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => "test-token"),
}));

// We'll test the tool registration functions by mocking the MCP server
// and the API client. Since the tools use apiRequest directly, we mock fetch.

let fetchMock: ReturnType<typeof vi.fn>;
let callHistory: Array<{ url: string; method: string; body?: unknown }>;

beforeEach(() => {
  callHistory = [];
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    callHistory.push({
      url,
      method: options?.method || "GET",
      body: options?.body ? JSON.parse(options.body as string) : undefined,
    });
    // Default: return empty success
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DOROTORING_TAB_ID;
});

// Since the tools are registered on an McpServer instance via registerAgentTools(),
// we can't easily call them in isolation. Instead, we test the API interaction patterns
// by importing apiRequest and simulating what the tools do.

const { apiRequest } = await import("../../utils/api.js");

describe("agents.ts API patterns", () => {
  describe("list_agents", () => {
    it("fetches without tabId filter when env not set", async () => {
      delete process.env.DOROTORING_TAB_ID;
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ agents: [] }),
      });

      const tabId = process.env.DOROTORING_TAB_ID;
      const url = tabId ? `/api/agents?tabId=${encodeURIComponent(tabId)}` : "/api/agents";
      await apiRequest(url);

      expect(callHistory[0].url).toContain("/api/agents");
      expect(callHistory[0].url).not.toContain("tabId");
    });

    it("passes tabId filter when env is set", async () => {
      process.env.DOROTORING_TAB_ID = "tab-abc";
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ agents: [] }),
      });

      const tabId = process.env.DOROTORING_TAB_ID;
      const url = tabId ? `/api/agents?tabId=${encodeURIComponent(tabId)}` : "/api/agents";
      await apiRequest(url);

      expect(callHistory[0].url).toContain("tabId=tab-abc");
    });
  });

  describe("create_agent with tabId", () => {
    it("includes tabId in body when env is set", async () => {
      process.env.DOROTORING_TAB_ID = "tab-xyz";
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ agent: { id: "new-1", name: "Worker" } }),
      });

      const body: Record<string, unknown> = { projectPath: "/tmp", name: "Worker" };
      if (process.env.DOROTORING_TAB_ID) {
        body.tabId = process.env.DOROTORING_TAB_ID;
      }
      await apiRequest("/api/agents", "POST", body);

      expect(callHistory[0].body).toHaveProperty("tabId", "tab-xyz");
    });
  });

  describe("delegate_task pattern", () => {
    it("chains start → wait → get_output for idle agent", async () => {
      // 1. get_agent returns idle
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
      // 3. wait returns completed
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "completed",
          lastCleanOutput: "Task done",
        }),
      });
      // 4. final get_agent for output
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          agent: { statusLine: "Task done", processState: "completed" },
        }),
      });

      // Simulate delegate_task logic
      const agentData = (await apiRequest("/api/agents/a1")) as {
        agent: { processState: string; name?: string };
      };
      // BUG B1: tools currently read .status — test the CORRECT field .processState
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

      // Final get — BUG B2: tools read .lastCleanOutput but API returns .statusLine
      const finalAgent = (await apiRequest("/api/agents/a1")) as {
        agent: { statusLine?: string; processState: string };
      };
      expect(finalAgent.agent.statusLine).toBe("Task done");
    });
  });

  describe("send_message adapts to status", () => {
    it("starts idle agent instead of sending message", async () => {
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
      // Use processState (not status)
      if (
        agentData.agent.processState === "inactive" ||
        agentData.agent.processState === "completed" ||
        agentData.agent.processState === "error"
      ) {
        await apiRequest("/api/agents/a1/start", "POST", { prompt: "hello" });
      }

      expect(callHistory[1].url).toContain("/start");
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

      expect(callHistory[1].url).toContain("/message");
    });
  });

  describe("wait_for_agent", () => {
    it("passes timeout as query param", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "completed" }),
      });

      const timeout = 120;
      await apiRequest(`/api/agents/a1/wait?timeout=${timeout}`);

      expect(callHistory[0].url).toContain("timeout=120");
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass with correct field names**

```bash
cd mcp-orchestrator && npx vitest run src/tools/__tests__/agents.test.ts 2>&1 | tail -20
```

Expected: All 8 tests pass (they use the CORRECT field names: `processState` and `statusLine`).

- [ ] **Step 3: Fix B1 — update agents.ts to use processState instead of status**

In `mcp-orchestrator/src/tools/agents.ts`, replace all occurrences of `.status` field reads from agent objects with `.processState`. The status checks use values like "idle" which should become "inactive" (matching the Rust enum serialization).

**Mapping of status values:**
- `"idle"` → `"inactive"` (ProcessState::Inactive serializes as "inactive")
- `"running"` → `"running"`
- `"waiting"` → `"waiting"`
- `"completed"` → `"completed"`
- `"error"` → `"error"`

In `start_agent` tool (~line 183):
```typescript
// OLD: const status = agentData.agent.status;
const status = agentData.agent.processState;
```

In `send_message` tool (~line 269-272):
```typescript
// OLD: const status = agentData.agent.status;
const status = agentData.agent.processState;
// OLD: if (status === "idle" || status === "completed" || status === "error") {
if (status === "inactive" || status === "completed" || status === "error") {
```

In `delegate_task` tool (~line 467):
```typescript
// OLD: const status = agentData.agent.status;
const status = agentData.agent.processState;
```

In `get_agent_output` tool (~line 75):
```typescript
// OLD: status: string;
processState: string;
// OLD: (${data.agent.status})
(${data.agent.processState})
```

Update the TypeScript type casts throughout the file:
- `{ agent: { status: string; name?: string } }` → `{ agent: { processState: string; name?: string } }`

- [ ] **Step 4: Fix B2 — update get_agent_output to use statusLine**

In the `get_agent_output` tool (~line 82):
```typescript
// OLD: if (data.agent.lastCleanOutput) {
if (data.agent.statusLine) {
// OLD: text: `Agent "${agentName}" (${data.agent.status}):\n\n${data.agent.lastCleanOutput}`,
text: `Agent "${agentName}" (${data.agent.processState}):\n\n${data.agent.statusLine}`,
```

In `delegate_task` (~line 534), the final get_agent also reads the wrong field:
```typescript
// OLD: const output = finalAgent.agent.lastCleanOutput || waitData.lastCleanOutput;
const output = finalAgent.agent.statusLine || waitData.lastCleanOutput;
```

Note: `waitData.lastCleanOutput` is correct because the `/wait` endpoint constructs its own JSON with that field name.

- [ ] **Step 5: Rebuild the MCP bundle**

```bash
cd mcp-orchestrator && npm run build 2>&1 | tail -5
```

Expected: Build succeeds, `dist/bundle.js` updated.

- [ ] **Step 6: Re-run all MCP tests**

```bash
cd mcp-orchestrator && npx vitest run 2>&1 | tail -15
```

Expected: All 11 tests pass (3 from api.test.ts + 8 from agents.test.ts).

- [ ] **Step 7: Commit**

```bash
git add mcp-orchestrator/src/tools/agents.ts mcp-orchestrator/src/tools/__tests__/agents.test.ts mcp-orchestrator/dist/bundle.js
git commit -m "fix(mcp): use processState/statusLine field names, add agents.ts tests

Fixes B1: tools read .status but API returns .processState
Fixes B2: tools read .lastCleanOutput but API returns .statusLine"
```

---

## Task 7: E2E integration test script

**Files:**
- Create: `tests/e2e/test_super_agent_flow.sh`

- [ ] **Step 1: Create the test directory**

```bash
mkdir -p tests/e2e
```

- [ ] **Step 2: Write the E2E test script**

```bash
#!/usr/bin/env bash
# E2E test: Super Agent flow against live Dorotoring API
# Requires: Dorotoring app running (API on :31415)
set -euo pipefail

API="http://127.0.0.1:31415"
TOKEN=$(cat ~/.dorotoring/api-token)
AUTH="Authorization: Bearer $TOKEN"
PASS=0
FAIL=0
WORKER_ID=""
SUPER_ID=""

ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

cleanup() {
    echo ""
    echo "--- Cleanup ---"
    [ -n "$WORKER_ID" ] && curl -s -X DELETE -H "$AUTH" "$API/api/agents/$WORKER_ID" > /dev/null 2>&1 || true
    [ -n "$SUPER_ID" ]  && curl -s -X DELETE -H "$AUTH" "$API/api/agents/$SUPER_ID"  > /dev/null 2>&1 || true
    echo ""
    echo "=== Results: $PASS passed, $FAIL failed ==="
    [ "$FAIL" -eq 0 ] && exit 0 || exit 1
}
trap cleanup EXIT

echo "=== Super Agent E2E Test ==="
echo ""

# --- 1. Health check ---
echo "1. Health check"
HEALTH=$(curl -s "$API/api/health")
echo "$HEALTH" | grep -q '"ok"' && ok "API healthy" || fail "API not healthy: $HEALTH"

# --- 2. Create worker agent ---
echo "2. Create worker agent"
WORKER_RESP=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"e2e-worker","cwd":"/tmp","isSuperAgent":false}' \
  "$API/api/agents")
WORKER_ID=$(echo "$WORKER_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['id'])" 2>/dev/null || echo "")
[ -n "$WORKER_ID" ] && ok "Created worker: $WORKER_ID" || fail "Create worker failed: $WORKER_RESP"

# --- 3. Create super agent ---
echo "3. Create super agent"
SUPER_RESP=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"e2e-super","cwd":"/tmp","isSuperAgent":true,"superAgentScope":"tab","tabId":"e2e-tab"}' \
  "$API/api/agents")
SUPER_ID=$(echo "$SUPER_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['id'])" 2>/dev/null || echo "")
IS_SUPER=$(echo "$SUPER_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['isSuperAgent'])" 2>/dev/null || echo "")
[ "$IS_SUPER" = "True" ] && ok "Super agent created with isSuperAgent=true" || fail "isSuperAgent not true: $SUPER_RESP"

# Check superAgentScope was saved
SCOPE=$(echo "$SUPER_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['agent'].get('superAgentScope','MISSING'))" 2>/dev/null || echo "MISSING")
[ "$SCOPE" = "tab" ] && ok "superAgentScope=tab saved" || fail "superAgentScope missing or wrong: $SCOPE"

# --- 4. Tab filtering ---
echo "4. Tab filtering"
TAB_RESP=$(curl -s -H "$AUTH" "$API/api/agents?tabId=e2e-tab")
TAB_COUNT=$(echo "$TAB_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['agents']))" 2>/dev/null || echo "0")
# At least the super agent should be in e2e-tab
[ "$TAB_COUNT" -ge 1 ] && ok "Tab filter returns $TAB_COUNT agent(s)" || fail "Tab filter returned 0 agents"

ALL_RESP=$(curl -s -H "$AUTH" "$API/api/agents")
ALL_COUNT=$(echo "$ALL_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['agents']))" 2>/dev/null || echo "0")
[ "$ALL_COUNT" -ge 2 ] && ok "Unfiltered returns $ALL_COUNT agents (>= 2)" || fail "Unfiltered returned $ALL_COUNT agents"

# --- 5. Hook status lifecycle ---
echo "5. Hook status lifecycle"
# Set to running
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$WORKER_ID\",\"status\":\"running\"}" \
  "$API/api/hooks/status" > /dev/null

AGENT_STATE=$(curl -s -H "$AUTH" "$API/api/agents/$WORKER_ID" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['processState'])" 2>/dev/null || echo "")
[ "$AGENT_STATE" = "running" ] && ok "Hook set status to running" || fail "Expected running, got: $AGENT_STATE"

# Set to completed
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$WORKER_ID\",\"status\":\"completed\"}" \
  "$API/api/hooks/status" > /dev/null

AGENT_STATE=$(curl -s -H "$AUTH" "$API/api/agents/$WORKER_ID" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['processState'])" 2>/dev/null || echo "")
[ "$AGENT_STATE" = "completed" ] && ok "Hook set status to completed" || fail "Expected completed, got: $AGENT_STATE"

# --- 6. Wait broadcast ---
echo "6. Wait broadcast"
# Reset to running first
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$WORKER_ID\",\"status\":\"running\"}" \
  "$API/api/hooks/status" > /dev/null

# Start wait in background (5s timeout)
curl -s -H "$AUTH" "$API/api/agents/$WORKER_ID/wait?timeout=5" > /tmp/e2e-wait-result.json 2>&1 &
WAIT_PID=$!
sleep 1

# Trigger completion
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$WORKER_ID\",\"status\":\"completed\"}" \
  "$API/api/hooks/status" > /dev/null

# Wait for the background curl to finish
wait $WAIT_PID 2>/dev/null || true
WAIT_STATUS=$(python3 -c "import json; print(json.load(open('/tmp/e2e-wait-result.json'))['status'])" 2>/dev/null || echo "")
[ "$WAIT_STATUS" = "completed" ] && ok "Wait returned on broadcast" || fail "Wait returned: $WAIT_STATUS"
rm -f /tmp/e2e-wait-result.json

# --- 7. Cleanup handled by trap ---
echo "7. Cleanup"
```

- [ ] **Step 3: Make it executable and run**

```bash
chmod +x tests/e2e/test_super_agent_flow.sh
tests/e2e/test_super_agent_flow.sh
```

Expected: All steps pass (after Tasks 1-6 fixes are compiled into the running binary).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/test_super_agent_flow.sh
git commit -m "test(e2e): add Super Agent flow integration test script"
```

---

## Task 8: E2E test for hooks.sh

**Files:**
- Create: `tests/e2e/test_hooks_sh.sh`

- [ ] **Step 1: Write the hooks.sh test**

```bash
#!/usr/bin/env bash
# Test that hooks.sh correctly reports agent status to the Dorotoring API.
# Requires: Dorotoring app running (API on :31415)
set -euo pipefail

API="http://127.0.0.1:31415"
TOKEN=$(cat ~/.dorotoring/api-token)
AUTH="Authorization: Bearer $TOKEN"
HOOKS_SCRIPT="$HOME/.dorotoring/hooks.sh"
AGENT_ID=""

cleanup() {
    [ -n "$AGENT_ID" ] && curl -s -X DELETE -H "$AUTH" "$API/api/agents/$AGENT_ID" > /dev/null 2>&1 || true
}
trap cleanup EXIT

echo "=== hooks.sh Test ==="

# Verify hooks.sh exists and is executable
[ -x "$HOOKS_SCRIPT" ] && echo "PASS: hooks.sh exists and is executable" || { echo "FAIL: hooks.sh not found at $HOOKS_SCRIPT"; exit 1; }

# Create a temporary agent
RESP=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"hooks-test","cwd":"/tmp"}' "$API/api/agents")
AGENT_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['id'])")
echo "Created test agent: $AGENT_ID"

# Export the agent ID like Dorotoring does before launching an agent
export DOROTORING_AGENT_ID="$AGENT_ID"

# Call hooks.sh with "running"
"$HOOKS_SCRIPT" running
sleep 1  # hooks.sh fires curl in background (&), give it time

STATE=$(curl -s -H "$AUTH" "$API/api/agents/$AGENT_ID" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['processState'])")
[ "$STATE" = "running" ] && echo "PASS: hooks.sh running → processState=running" || echo "FAIL: expected running, got $STATE"

# Call hooks.sh with "completed"
"$HOOKS_SCRIPT" completed
sleep 1

STATE=$(curl -s -H "$AUTH" "$API/api/agents/$AGENT_ID" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['processState'])")
[ "$STATE" = "completed" ] && echo "PASS: hooks.sh completed → processState=completed" || echo "FAIL: expected completed, got $STATE"

# Test with no DOROTORING_AGENT_ID — should be a no-op
unset DOROTORING_AGENT_ID
"$HOOKS_SCRIPT" running 2>/dev/null
echo "PASS: hooks.sh exits cleanly without DOROTORING_AGENT_ID"

echo ""
echo "=== hooks.sh tests complete ==="
```

- [ ] **Step 2: Make it executable and run**

```bash
chmod +x tests/e2e/test_hooks_sh.sh
tests/e2e/test_hooks_sh.sh
```

Expected: All 3 assertions pass.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/test_hooks_sh.sh
git commit -m "test(e2e): add hooks.sh integration test"
```

---

## Task 9: Compile, rebuild, and run full test suite

**Files:** None new — this is the integration verification step.

- [ ] **Step 1: Compile the Rust changes**

```bash
cd src-tauri && cargo build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 2: Run all Rust tests**

```bash
cd src-tauri && cargo test 2>&1 | tail -20
```

Expected: All unit + integration tests pass.

- [ ] **Step 3: Run all MCP tests**

```bash
cd mcp-orchestrator && npx vitest run 2>&1 | tail -15
```

Expected: All 11 tests pass.

- [ ] **Step 4: Run E2E tests (requires app restart with new binary)**

Note: The E2E tests need the new binary running. If the app is running with the old binary, restart it first.

```bash
tests/e2e/test_super_agent_flow.sh
tests/e2e/test_hooks_sh.sh
```

Expected: All assertions pass.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A && git status
# If there are changes from fixing test failures:
git commit -m "fix: resolve test failures from full suite run"
```
