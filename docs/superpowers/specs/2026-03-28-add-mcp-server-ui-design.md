# Add MCP Server from UI — Design Spec

**Date:** 2026-03-28
**Scope:** `src/components/Settings/McpSection.tsx` only — no backend changes required.

---

## Context

The Custom MCP Servers section in Settings currently supports viewing, editing, and deleting servers. It cannot create new ones from the UI. The Electron backend (`mcp:update` IPC) already handles both create and update — a new name creates a new entry, an existing name overwrites it. This feature adds a creation UI only.

---

## Entry Point

A `+ Add` button is added to the existing header row of the server list card (the row that contains the provider name, server count, and Refresh button). Clicking it sets `showAddModal = true`.

---

## Modal

A shadcn/ui `Dialog` with the following fields:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | text input | yes | Validated unique against current server list at submit |
| Command | text input | yes | e.g. `npx`, `node` |
| Arguments | dynamic list | no | Add/Remove buttons, same pattern as the existing editor |
| Environment Variables | dynamic key/value list | no | Same pattern as existing editor (masked values by default) |

**Submit behavior:**
1. If `name` matches an existing server → show inline error "A server with this name already exists", do not close.
2. Otherwise → call `window.electronAPI?.mcp?.update({ provider, name, command, args, env })`, on success refresh the server list and close the modal.

**Cancel:** closes the modal, discards draft state.

**State:** All modal draft state (`draftName`, `draftCommand`, `draftArgs`, `draftEnv`) is reset when the modal opens.

---

## Error Handling

- Duplicate name: inline error message below the Name field.
- IPC failure: inline error at the bottom of the modal (same `error` state pattern used elsewhere in the component).

---

## Constraints

- No new files — all changes inside `McpSection.tsx`.
- No backend changes — `mcp:update` already handles creation.
- Follows existing patterns for args/env editing and error display.
