# Add MCP Server from UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a modal dialog to create new MCP servers from the Settings UI without leaving the app.

**Architecture:** All changes are confined to `src/components/Settings/McpSection.tsx`. The modal uses shadcn `Dialog`, follows the existing args/env editing patterns in the file, and calls the existing `mcp:update` IPC (which creates a server when given a new name). No backend or preload changes required.

**Tech Stack:** React, shadcn/ui Dialog, lucide-react icons, existing `window.electronAPI.mcp.update`

---

### Task 1: Add modal state and reset helper

**Files:**
- Modify: `src/components/Settings/McpSection.tsx`

- [ ] **Step 1: Add state variables at the top of the `McpSection` component, after the existing state declarations**

  Locate the block starting at line 64 (`const [provider, setProvider] = useState<Provider>('claude');`). After the last existing `useState` call (line 73, `maskedEnvKeys`), add:

  ```tsx
  const [showAddModal, setShowAddModal] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftCommand, setDraftCommand] = useState('');
  const [draftArgs, setDraftArgs] = useState<string[]>([]);
  const [draftEnv, setDraftEnv] = useState<Record<string, string>>({});
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  ```

- [ ] **Step 2: Add the `openAddModal` helper right after the state block**

  ```tsx
  const openAddModal = () => {
    setDraftName('');
    setDraftCommand('');
    setDraftArgs([]);
    setDraftEnv({});
    setAddError(null);
    setShowAddModal(true);
  };
  ```

- [ ] **Step 3: Verify the file still compiles**

  ```bash
  npx tsc --noEmit
  ```
  Expected: no errors related to McpSection.

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/Settings/McpSection.tsx
  git commit -m "feat(mcp): add modal state and reset helper"
  ```

---

### Task 2: Add the "+ Add" button to the card header

**Files:**
- Modify: `src/components/Settings/McpSection.tsx`

- [ ] **Step 1: Locate the header row in the JSX**

  Find the `<div className="flex items-center justify-between pb-4">` block (around line 284). It contains the server count on the left and the Refresh button on the right. The Refresh button looks like:

  ```tsx
  <button
    onClick={() => loadServers(provider)}
    disabled={loading}
    className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
    title="Refresh"
  >
    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
  </button>
  ```

- [ ] **Step 2: Replace that single Refresh button with a flex group containing both buttons**

  Replace the lone Refresh `<button>` with:

  ```tsx
  <div className="flex items-center gap-1">
    <button
      onClick={openAddModal}
      className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
      title="Add server"
    >
      <Plus className="w-4 h-4" />
    </button>
    <button
      onClick={() => loadServers(provider)}
      disabled={loading}
      className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
      title="Refresh"
    >
      <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
    </button>
  </div>
  ```

  Note: `Plus` is already imported at line 8 — no import change needed.

- [ ] **Step 3: Verify the file compiles**

  ```bash
  npx tsc --noEmit
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/Settings/McpSection.tsx
  git commit -m "feat(mcp): add '+ Add' button to server list header"
  ```

---

### Task 3: Implement the Dialog with Name, Command, Args, and Env fields

**Files:**
- Modify: `src/components/Settings/McpSection.tsx`

- [ ] **Step 1: Add Dialog import at the top of the file**

  After the existing import block, add:

  ```tsx
  import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
  ```

- [ ] **Step 2: Add the modal submit handler before the `return` statement**

  Insert the `handleAdd` function after `openAddModal`:

  ```tsx
  const handleAdd = async () => {
    const trimmedName = draftName.trim();
    if (!trimmedName) {
      setAddError('Name is required.');
      return;
    }
    if (servers.some(s => s.name === trimmedName)) {
      setAddError('A server with this name already exists.');
      return;
    }
    if (!draftCommand.trim()) {
      setAddError('Command is required.');
      return;
    }
    setAddSaving(true);
    setAddError(null);
    try {
      const result = await window.electronAPI?.mcp?.update({
        provider,
        name: trimmedName,
        command: draftCommand.trim(),
        args: draftArgs.filter(a => a.trim() !== ''),
        env: Object.fromEntries(
          Object.entries(draftEnv).filter(([k]) => k.trim() !== '')
        ),
      });
      if (result?.success) {
        setShowAddModal(false);
        await loadServers(provider);
      } else {
        setAddError(result?.error || 'Failed to add server.');
      }
    } catch (err) {
      setAddError(String(err));
    } finally {
      setAddSaving(false);
    }
  };
  ```

- [ ] **Step 3: Add the Dialog JSX just before the closing `</div>` of the component's return**

  Find the final `</div>` closing the root `<div className="space-y-6">`. Insert the Dialog before it:

  ```tsx
  <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
    <DialogContent className="max-w-lg">
      <DialogTitle>Add MCP Server</DialogTitle>

      <div className="space-y-4 mt-2">
        {/* Name */}
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Name</Label>
          <Input
            type="text"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            placeholder="my-mcp-server"
            className="font-mono"
            autoFocus
          />
        </div>

        {/* Command */}
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Command</Label>
          <Input
            type="text"
            value={draftCommand}
            onChange={e => setDraftCommand(e.target.value)}
            placeholder="npx"
            className="font-mono"
          />
        </div>

        {/* Args */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-xs text-muted-foreground">Arguments</Label>
            <button
              onClick={() => setDraftArgs(prev => [...prev, ''])}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          {draftArgs.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No arguments</p>
          )}
          <div className="space-y-1">
            {draftArgs.map((arg, idx) => (
              <div key={idx} className="flex gap-1">
                <Input
                  type="text"
                  value={arg}
                  onChange={e => {
                    const next = [...draftArgs];
                    next[idx] = e.target.value;
                    setDraftArgs(next);
                  }}
                  className="flex-1 font-mono h-8"
                  placeholder={`arg ${idx}`}
                />
                <button
                  onClick={() => setDraftArgs(prev => prev.filter((_, i) => i !== idx))}
                  className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Env vars */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-xs text-muted-foreground">Environment Variables</Label>
            <button
              onClick={() => setDraftEnv(prev => ({ ...prev, '': '' }))}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          {Object.keys(draftEnv).length === 0 && (
            <p className="text-xs text-muted-foreground italic">No environment variables</p>
          )}
          <div className="space-y-1">
            {Object.entries(draftEnv).map(([key, value]) => (
              <div key={key} className="flex gap-1">
                <Input
                  type="text"
                  value={key}
                  onChange={e => {
                    const newKey = e.target.value;
                    setDraftEnv(prev => {
                      const entries = Object.entries(prev);
                      const newEnv: Record<string, string> = {};
                      for (const [k, v] of entries) {
                        newEnv[k === key ? newKey : k] = v;
                      }
                      return newEnv;
                    });
                  }}
                  className="w-[40%] font-mono h-8"
                  placeholder="KEY"
                />
                <Input
                  type="text"
                  value={value}
                  onChange={e => setDraftEnv(prev => ({ ...prev, [key]: e.target.value }))}
                  className="flex-1 font-mono h-8"
                  placeholder="value"
                />
                <button
                  onClick={() => setDraftEnv(prev => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                  })}
                  className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Error */}
        {addError && (
          <div className="p-3 text-sm flex items-center gap-2 bg-red-700/10 text-destructive border border-red-700/20">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {addError}
          </div>
        )}

        {/* Actions */}
        <Separator />
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowAddModal(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleAdd} disabled={addSaving}>
            {addSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add Server
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
  ```

- [ ] **Step 4: Verify the file compiles**

  ```bash
  npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/Settings/McpSection.tsx
  git commit -m "feat(mcp): implement Add Server modal dialog"
  ```

---

### Task 4: Manual verification

- [ ] **Step 1: Start the app**

  ```bash
  npm run dev
  ```

- [ ] **Step 2: Navigate to Settings → Custom MCP Servers**

  Confirm the `+` button appears next to the Refresh button in the card header.

- [ ] **Step 3: Click `+` — modal opens with empty fields**

  Confirm all fields are blank, no error shown.

- [ ] **Step 4: Submit with empty Name — inline error appears**

  Click "Add Server" without filling anything. Confirm "Name is required." appears inside the modal.

- [ ] **Step 5: Fill Name only with an existing server name — duplicate error**

  If there's an existing server, type its name and submit. Confirm "A server with this name already exists." appears.

- [ ] **Step 6: Fill valid Name + Command, click Add Server**

  Use a name that doesn't exist, e.g. `test-server`, command `echo`. Click Add Server. Confirm the modal closes and the new server appears in the list.

- [ ] **Step 7: Verify the new entry in the config file**

  For Claude provider:
  ```bash
  cat ~/.claude/mcp.json | python3 -m json.tool | grep -A5 "test-server"
  ```
  Expected: the entry is present with `command: "echo"`.

- [ ] **Step 8: Delete the test server via the UI to clean up**

  Expand `test-server` in the list, click Delete, confirm it disappears.
