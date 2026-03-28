# Project Documentation Viewer & CWD Sync

## Summary

Three related features:
1. **Agent CWD sync** -- reliable synchronization of agent working directory so projects are always accurate
2. **Project docs viewer** -- integrated markdown documentation reader in the Projects page
3. **Agent-to-project link** -- clickable project badge on agent cards navigates to the project with docs open

## Part 1: CWD Sync Rework

### Problem

Agents are created with `cwd: "/home/flavien"` (home dir default). The CWD never updates because:
- `CwdTracker` updated the legacy HashMap instead of the `AgentManager` (persistence layer)
- `CwdTracker` tracked the shell PID, not the claude child process
- Reused PTYs (the common path) were never registered with `CwdTracker`
- The `hooks.sh` status hook didn't report the working directory

### Solution: 5 layers of defense

#### Layer 1: Fix reused PTY registration (bug)

In `agent_start` (`src-tauri/src/commands/agent.rs`), when `reused_pty = true`, get the existing PTY's child PID and call `cwd_tracker.register()`. Currently only new PTYs are registered.

```
// After the reused_pty branch:
if reused_pty {
    if let Some(pid) = pty_manager.get_child_pid(&pty_id) {
        cwd_tracker.register(&pty_id, pid);
    }
}
```

#### Layer 2: CwdTracker updates AgentManager (done)

`cwd_tracker.rs` -- `start_polling` accepts `Arc<AgentManager>` instead of the legacy `Arc<Mutex<HashMap>>`. Updates are persisted to `agents.json` and emit `agent:cwd-changed` events.

#### Layer 3: CwdTracker follows deepest descendant (done)

`cwd_tracker.rs` -- `find_deepest_descendant()` walks `/proc/<pid>/task/<pid>/children` recursively to find the claude/node process inside the shell. Reads its `/proc/<pid>/cwd` instead of the shell's.

#### Layer 4: Hook sends CWD (done)

`hooks.sh` -- sends `$PWD` in the JSON payload to `/api/hooks/status`. The `hook_status` handler in `api_server.rs` updates `agent.cwd` via `AgentManager` and emits `agent:cwd-changed`.

#### Layer 5: Hook detects git root

Improve `hooks.sh` to send `git rev-parse --show-toplevel` instead of raw `$PWD`. This resolves the project root even when claude is working in a subdirectory.

```bash
CWD=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")
```

### Files to modify

| File | Change |
|------|--------|
| `src-tauri/src/commands/agent.rs` | Register reused PTYs with cwd_tracker |
| `src-tauri/src/cwd_tracker.rs` | Already done: AgentManager + deepest descendant |
| `src-tauri/src/hooks.sh` | Already done ($PWD), add git root detection |
| `src-tauri/src/api_server.rs` | Already done: hook_status updates cwd |
| `src-tauri/src/lib.rs` | Already done: pass AgentManager to CwdTracker |

## Part 2: Project Documentation Viewer

### Layout

The Projects page (`src/routes/projects.tsx`) becomes a split view:

- **Left panel (~350px)**: Project list (existing cards, compacted)
- **Right panel (remaining space)**: Documentation viewer for selected project
  - Header: project name, path, agent count
  - File tree: markdown files found in the project
  - Content area: rendered markdown using existing `MarkdownRenderer`

When no project is selected, the left panel takes full width (current behavior).

### Doc file discovery

New Tauri command `project_list_docs(path: String) -> Vec<DocEntry>`:

```rust
struct DocEntry {
    name: String,      // "README.md"
    path: String,      // "/home/.../project/README.md"
    relative: String,  // "README.md" or "docs/architecture.md"
    is_dir: bool,
}
```

Scan strategy:
- `*.md` files at project root
- `docs/` directory recursively (all `.md` files)
- Ignore `node_modules/`, `.git/`, `target/`, `dist/`, `build/`
- Sort: directories first, then alphabetical

### Doc file reading

New Tauri command `project_read_doc(path: String, project_root: String) -> String`:
- Reads file content as UTF-8
- Security: validates that `path` is a descendant of `project_root` (no path traversal)

### New components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ProjectDocsPanel` | `src/components/ProjectDocs/ProjectDocsPanel.tsx` | Main split-right container |
| `DocFileTree` | `src/components/ProjectDocs/DocFileTree.tsx` | Tree view of .md files |

Reuses `MarkdownRenderer` from `src/components/VaultView/components/MarkdownRenderer.tsx`.

### State management

- `selectedProject: string | null` -- path of selected project (local state in ProjectsPage)
- `selectedDoc: string | null` -- path of selected doc file
- `docFiles: DocEntry[]` -- list of doc files for selected project
- `docContent: string` -- content of selected doc

All local React state, no global store needed.

## Part 3: Agent-to-Project Navigation

### Agent card project badge

In `AgentCard.tsx`, the project badge (showing `agent.cwd.split('/').pop()`) becomes a clickable link:

```tsx
onClick={() => navigate(`/projects?select=${encodeURIComponent(agent.cwd)}`)}
```

Stops event propagation to avoid triggering the card's own onClick.

### Projects page query param handling

In `projects.tsx`, on mount:
- Read `searchParams.get('select')`
- If present, find matching project by path and auto-select it
- This opens the split view with the project's documentation

### Data flow

```
AgentCard click on project badge
    -> navigate("/projects?select=/home/.../MyProject")
    -> ProjectsPage reads searchParams
    -> setSelectedProject(path)
    -> ProjectDocsPanel mounts
    -> invoke("project_list_docs", path)
    -> User clicks .md file
    -> invoke("project_read_doc", filePath, projectRoot)
    -> MarkdownRenderer displays content
```
