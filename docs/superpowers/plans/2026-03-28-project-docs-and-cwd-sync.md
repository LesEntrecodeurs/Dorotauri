# Project Documentation Viewer & CWD Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliable agent CWD synchronization + integrated markdown docs viewer in the Projects page + clickable project links on agent cards.

**Architecture:** Fix 5 layers of CWD tracking (reused PTY registration, AgentManager updates, deepest-descendant PID, hook $PWD, git root detection). Add two Tauri commands for doc file listing/reading. Add split-view layout to Projects page with doc tree + markdown renderer. Make agent card project badges navigable.

**Tech Stack:** Rust/Tauri (backend commands), React/TypeScript (frontend), existing MarkdownRenderer component.

---

## File Structure

### Backend (Rust)

| File | Action | Responsibility |
|------|--------|----------------|
| `src-tauri/src/commands/agent.rs` | Modify | Register reused PTYs with cwd_tracker |
| `src-tauri/src/hooks.sh` | Modify | Send git root instead of raw $PWD |
| `src-tauri/src/commands/shell.rs` | Modify | Add `project_list_docs` and `project_read_doc` commands |
| `src-tauri/src/commands/mod.rs` | Modify | (already exports shell) |
| `src-tauri/src/lib.rs` | Modify | Register new Tauri commands |

### Frontend (TypeScript/React)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/ProjectDocs/DocFileTree.tsx` | Create | Tree view of .md files in a project |
| `src/components/ProjectDocs/ProjectDocsPanel.tsx` | Create | Container: header + file tree + markdown content |
| `src/routes/projects.tsx` | Modify | Split view layout, query param handling |
| `src/components/AgentList/AgentCard.tsx` | Modify | Clickable project badge with navigation |

---

### Task 1: Fix reused PTY registration in agent_start

**Files:**
- Modify: `src-tauri/src/commands/agent.rs:310-314`

- [ ] **Step 1: Add cwd_tracker registration for reused PTYs**

In `agent_start`, after the `if reused_pty` block that sets up the EventBus channel (line 311-314), add CWD tracker registration:

```rust
    // Ensure EventBus PTY channel exists (for reused PTYs spawned without one)
    if reused_pty {
        let bus_tx = state.event_bus.create_pty_channel(&id);
        pty_manager.set_event_bus_tx(&pty_id, bus_tx);

        // Register reused PTY with cwd tracker so directory changes are tracked
        if let Some(pid) = pty_manager.get_child_pid(&pty_id) {
            cwd_tracker.register(&pty_id, pid);
        }
    }
```

- [ ] **Step 2: Build and verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: compilation succeeds with only pre-existing warnings.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/agent.rs
git commit -m "fix: register reused PTYs with cwd_tracker in agent_start"
```

---

### Task 2: Hook sends git root instead of raw $PWD

**Files:**
- Modify: `src-tauri/src/hooks.sh`

- [ ] **Step 1: Update hooks.sh to detect git root**

Replace the current hooks.sh content with:

```bash
#!/bin/bash
# Dorotoring hooks script — called by Claude Code hooks to report agent status.
# Usage: hooks.sh <status>   (e.g. "running", "completed")
# Requires DOROTORING_AGENT_ID in the environment (set by Dorotoring before launching the agent).

STATUS="$1"
AGENT_ID="$DOROTORING_AGENT_ID"
API_URL="${CLAUDE_MGR_API_URL:-http://127.0.0.1:31415}"

# Not a Dorotoring-managed agent — nothing to do
[ -z "$AGENT_ID" ] && exit 0

# Resolve project root: prefer git root, fall back to $PWD
CWD=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")

# Fire-and-forget POST to the status hook endpoint (no auth required)
curl -s -o /dev/null -X POST "$API_URL/api/hooks/status" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_ID\",\"status\":\"$STATUS\",\"cwd\":\"$CWD\"}" &
```

- [ ] **Step 2: Copy updated script to installed location**

Run: `cp src-tauri/src/hooks.sh ~/.dorotoring/hooks.sh`

- [ ] **Step 3: Build to verify include_str! picks up changes**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: compilation succeeds.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/hooks.sh
git commit -m "fix: hooks.sh sends git root instead of raw \$PWD for accurate project detection"
```

---

### Task 3: Add project_list_docs and project_read_doc Tauri commands

**Files:**
- Modify: `src-tauri/src/commands/shell.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add DocEntry struct and project_list_docs command to shell.rs**

Append after the existing `projects_list` function in `src-tauri/src/commands/shell.rs`:

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocEntry {
    pub name: String,
    pub path: String,
    pub relative: String,
    pub is_dir: bool,
}

#[tauri::command]
pub fn project_list_docs(project_path: String) -> Vec<DocEntry> {
    let root = std::path::Path::new(&project_path);
    if !root.is_dir() {
        return Vec::new();
    }

    let mut entries: Vec<DocEntry> = Vec::new();

    // Collect .md files at project root
    if let Ok(dir) = fs::read_dir(root) {
        for entry in dir.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext.eq_ignore_ascii_case("md") {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let relative = name.clone();
                        entries.push(DocEntry {
                            name,
                            path: path.to_string_lossy().to_string(),
                            relative,
                            is_dir: false,
                        });
                    }
                }
            }
        }
    }

    // Recursively collect from docs/ directory
    let docs_dir = root.join("docs");
    if docs_dir.is_dir() {
        collect_md_files(&docs_dir, root, &mut entries);
    }

    // Sort: directories first, then alphabetical
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.relative.to_lowercase().cmp(&b.relative.to_lowercase()),
        }
    });

    entries
}

fn collect_md_files(dir: &std::path::Path, root: &std::path::Path, entries: &mut Vec<DocEntry>) {
    let skip_dirs = ["node_modules", ".git", "target", "dist", "build", "__pycache__"];

    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };

    for entry in read_dir.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if skip_dirs.contains(&name.as_str()) {
                continue;
            }
            collect_md_files(&path, root, entries);
        } else if path.is_file() {
            if let Some(ext) = path.extension() {
                if ext.eq_ignore_ascii_case("md") {
                    let relative = path
                        .strip_prefix(root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .to_string();
                    entries.push(DocEntry {
                        name,
                        path: path.to_string_lossy().to_string(),
                        relative,
                        is_dir: false,
                    });
                }
            }
        }
    }
}
```

- [ ] **Step 2: Add project_read_doc command to shell.rs**

Append after `collect_md_files`:

```rust
#[tauri::command]
pub fn project_read_doc(file_path: String, project_root: String) -> Result<String, String> {
    let file = std::path::Path::new(&file_path);
    let root = std::path::Path::new(&project_root);

    // Security: ensure file_path is under project_root (no path traversal)
    let canonical_file = file
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path: {e}"))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve project root: {e}"))?;

    if !canonical_file.starts_with(&canonical_root) {
        return Err("Access denied: path is outside project directory".to_string());
    }

    fs::read_to_string(&canonical_file)
        .map_err(|e| format!("Failed to read file: {e}"))
}
```

- [ ] **Step 3: Register commands in lib.rs**

In `src-tauri/src/lib.rs`, find the line `commands::shell::projects_list,` and add the new commands after it:

```rust
            commands::shell::projects_list,
            commands::shell::project_list_docs,
            commands::shell::project_read_doc,
```

- [ ] **Step 4: Build and verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: compilation succeeds.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/shell.rs src-tauri/src/lib.rs
git commit -m "feat: add project_list_docs and project_read_doc Tauri commands"
```

---

### Task 4: Create DocFileTree component

**Files:**
- Create: `src/components/ProjectDocs/DocFileTree.tsx`

- [ ] **Step 1: Create the DocFileTree component**

Create `src/components/ProjectDocs/DocFileTree.tsx`:

```tsx
import { FileText, ChevronRight, ChevronDown, FolderOpen } from 'lucide-react';
import { useState, useMemo } from 'react';

export interface DocEntry {
  name: string;
  path: string;
  relative: string;
  isDir: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  relative: string;
  isDir: boolean;
  children: TreeNode[];
}

interface DocFileTreeProps {
  files: DocEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function buildTree(files: DocEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  for (const file of files) {
    const parts = file.relative.split('/');
    if (parts.length === 1) {
      root.push({ ...file, children: [] });
    } else {
      let currentChildren = root;
      let currentPath = '';
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
        let dirNode = dirMap.get(currentPath);
        if (!dirNode) {
          dirNode = {
            name: parts[i],
            path: currentPath,
            relative: currentPath,
            isDir: true,
            children: [],
          };
          dirMap.set(currentPath, dirNode);
          currentChildren.push(dirNode);
        }
        currentChildren = dirNode.children;
      }
      currentChildren.push({ ...file, children: [] });
    }
  }

  return root;
}

function TreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = node.path === selectedPath;

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 shrink-0" />
          )}
          <FolderOpen className="w-3.5 h-3.5 shrink-0 text-amber-500" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex items-center gap-1.5 w-full px-2 py-1 text-xs transition-colors ${
        isSelected
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      }`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      title={node.relative}
    >
      <FileText className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function DocFileTree({ files, selectedPath, onSelect }: DocFileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);

  if (files.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground text-center">
        No documentation files found
      </div>
    );
  }

  return (
    <div className="py-1">
      {tree.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ProjectDocs/DocFileTree.tsx
git commit -m "feat: add DocFileTree component for project documentation navigation"
```

---

### Task 5: Create ProjectDocsPanel component

**Files:**
- Create: `src/components/ProjectDocs/ProjectDocsPanel.tsx`

- [ ] **Step 1: Create the ProjectDocsPanel component**

Create `src/components/ProjectDocs/ProjectDocsPanel.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileText, Bot, X } from 'lucide-react';
import { DocFileTree } from './DocFileTree';
import type { DocEntry } from './DocFileTree';
import { MarkdownRenderer } from '@/components/VaultView/components/MarkdownRenderer';

interface ProjectDocsPanelProps {
  projectPath: string;
  projectName: string;
  agentCount: number;
  onClose: () => void;
}

export function ProjectDocsPanel({ projectPath, projectName, agentCount, onClose }: ProjectDocsPanelProps) {
  const [docFiles, setDocFiles] = useState<DocEntry[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [docContent, setDocContent] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Load doc file list
  useEffect(() => {
    let cancelled = false;
    invoke<DocEntry[]>('project_list_docs', { projectPath }).then((files) => {
      if (!cancelled) {
        setDocFiles(files);
        // Auto-select README.md if present
        const readme = files.find(
          (f) => f.name.toLowerCase() === 'readme.md'
        );
        if (readme) {
          setSelectedDoc(readme.path);
        }
      }
    }).catch(() => {
      if (!cancelled) setDocFiles([]);
    });
    return () => { cancelled = true; };
  }, [projectPath]);

  // Load selected doc content
  const loadDoc = useCallback(async (filePath: string) => {
    setSelectedDoc(filePath);
    setLoading(true);
    try {
      const content = await invoke<string>('project_read_doc', {
        filePath,
        projectRoot: projectPath,
      });
      setDocContent(content);
    } catch {
      setDocContent('*Failed to load file.*');
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  // Load content when selectedDoc changes
  useEffect(() => {
    if (selectedDoc) {
      loadDoc(selectedDoc);
    }
  }, [selectedDoc, loadDoc]);

  const selectedFileName = selectedDoc
    ? docFiles.find((f) => f.path === selectedDoc)?.relative || selectedDoc.split('/').pop()
    : null;

  return (
    <div className="flex flex-col h-full border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <h3 className="font-medium text-sm truncate">{projectName}</h3>
            {agentCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 shrink-0">
                <Bot className="w-3 h-3" />
                {agentCount}
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground truncate mt-0.5 font-mono">{projectPath}</p>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content: sidebar + markdown */}
      <div className="flex flex-1 min-h-0">
        {/* File tree sidebar */}
        <div className="w-48 border-r border-border overflow-y-auto shrink-0">
          <DocFileTree
            files={docFiles}
            selectedPath={selectedDoc}
            onSelect={setSelectedDoc}
          />
        </div>

        {/* Markdown content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : selectedDoc ? (
            <div>
              {selectedFileName && (
                <p className="text-[10px] text-muted-foreground font-mono mb-4">{selectedFileName}</p>
              )}
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <MarkdownRenderer content={docContent} />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <FileText className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">Select a document to view</p>
              <p className="text-xs mt-1">{docFiles.length} file{docFiles.length !== 1 ? 's' : ''} found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ProjectDocs/ProjectDocsPanel.tsx
git commit -m "feat: add ProjectDocsPanel component with doc tree and markdown viewer"
```

---

### Task 6: Add split view to Projects page

**Files:**
- Modify: `src/routes/projects.tsx`

- [ ] **Step 1: Add imports and query param handling**

At the top of `src/routes/projects.tsx`, add to the existing import from `react-router-dom` (or add the import if not present):

```tsx
import { useSearchParams } from 'react-router-dom';
```

Add the ProjectDocsPanel import after the existing imports:

```tsx
import { ProjectDocsPanel } from '@/components/ProjectDocs/ProjectDocsPanel';
```

- [ ] **Step 2: Add useSearchParams and auto-select logic**

Inside the `ProjectsPage` component, after the existing `useState` declarations (around line 104), add:

```tsx
  const [searchParams, setSearchParams] = useSearchParams();
```

After the `useEffect` that loads favorites/hidden from app settings (around line 225), add:

```tsx
  // Auto-select project from query param (e.g. from agent card click)
  useEffect(() => {
    const selectPath = searchParams.get('select');
    if (selectPath && allProjects.length > 0) {
      const match = allProjects.find(p => pathsMatch(p.path, selectPath));
      if (match) {
        setSelectedProject(match);
      }
      // Clear the query param after processing
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, allProjects]);
```

- [ ] **Step 3: Wrap the return JSX in a split layout**

Replace the opening of the return block (line ~487):

```tsx
  return (
    <div className="space-y-4 lg:space-y-6 pt-4 lg:pt-6">
```

With a flex split layout:

```tsx
  return (
    <div className="flex h-full">
      {/* Left panel: project list */}
      <div className={`${selectedProject ? 'w-[420px] shrink-0 border-r border-border' : 'flex-1'} overflow-y-auto`}>
      <div className="space-y-4 lg:space-y-6 pt-4 lg:pt-6 px-4 lg:px-6">
```

- [ ] **Step 4: Close the left panel and add the right panel**

At the very end of the return, before the final closing `</div>`, replace the single closing `</div>` with:

```tsx
      </div>{/* end space-y wrapper */}
      </div>{/* end left panel */}

      {/* Right panel: documentation viewer */}
      {selectedProject && (
        <div className="flex-1 min-w-0">
          <ProjectDocsPanel
            projectPath={selectedProject.path}
            projectName={selectedProject.name}
            agentCount={agents.filter(a => pathsMatch(a.cwd, selectedProject.path)).length}
            onClose={() => setSelectedProject(null)}
          />
        </div>
      )}
    </div>
```

- [ ] **Step 5: Build frontend to verify**

Run: `npm run build 2>&1 | tail -10` (from project root)
Expected: no TypeScript or build errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/projects.tsx
git commit -m "feat: add split view layout to Projects page with documentation panel"
```

---

### Task 7: Make agent card project badge clickable

**Files:**
- Modify: `src/components/AgentList/AgentCard.tsx`

- [ ] **Step 1: Add useNavigate import**

At the top of `AgentCard.tsx`, add:

```tsx
import { useNavigate } from 'react-router-dom';
```

- [ ] **Step 2: Add navigate hook inside the component**

Inside the `AgentCard` component function, after `const isSubAgent = ...` (line 28), add:

```tsx
  const navigate = useNavigate();
```

- [ ] **Step 3: Make the project badge clickable**

Replace the project Badge (lines 136-142):

```tsx
            <Badge
              variant="secondary"
              className={`text-[10px] px-1.5 py-0.5 font-medium truncate max-w-[100px] ${projectColor.bg} ${projectColor.text}`}
              title={agent.cwd}
            >
              {projectName}
            </Badge>
```

With a clickable version:

```tsx
            <Badge
              variant="secondary"
              className={`text-[10px] px-1.5 py-0.5 font-medium truncate max-w-[100px] cursor-pointer hover:opacity-80 transition-opacity ${projectColor.bg} ${projectColor.text}`}
              title={`${agent.cwd} — click to view project`}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/projects?select=${encodeURIComponent(agent.cwd)}`);
              }}
            >
              {projectName}
            </Badge>
```

- [ ] **Step 4: Build frontend to verify**

Run: `npm run build 2>&1 | tail -10`
Expected: no TypeScript or build errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/AgentList/AgentCard.tsx
git commit -m "feat: make agent card project badge clickable with navigation to Projects page"
```

---

### Task 8: Verify full build and manual test

**Files:** None (verification only)

- [ ] **Step 1: Full Rust build**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10`
Expected: compilation succeeds.

- [ ] **Step 2: Full frontend build**

Run: `npm run build 2>&1 | tail -10`
Expected: no errors.

- [ ] **Step 3: Verify CWD sync changes are complete**

Check that all 5 layers are in place:
1. `grep -n "reused_pty" src-tauri/src/commands/agent.rs | head -5` — should show cwd_tracker.register in the reused_pty block
2. `grep -n "AgentManager" src-tauri/src/cwd_tracker.rs | head -3` — should reference AgentManager
3. `grep -n "find_deepest_descendant" src-tauri/src/cwd_tracker.rs | head -3` — should exist
4. `grep "cwd" src-tauri/src/hooks.sh` — should show git rev-parse
5. `grep "body.cwd" src-tauri/src/api_server.rs | head -3` — should show cwd update logic

- [ ] **Step 4: Verify new commands are registered**

Run: `grep "project_list_docs\|project_read_doc" src-tauri/src/lib.rs`
Expected: both commands appear in the invoke_handler.

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -A
git commit -m "chore: verification pass for project docs and cwd sync"
```
