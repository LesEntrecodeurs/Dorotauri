# Sidebar Usage Widget

## Context

Dorothy users on Claude Pro/Max subscriptions need visibility into their API rate-limit consumption without leaving the app. Currently, usage data is only available on the dedicated `/usage` page (token costs) or by visiting `claude.ai/settings/usage`. The goal is to surface session and weekly usage percentages in the sidebar for at-a-glance awareness.

## Design

### Placement

The widget lives in the **sidebar bottom section**, between the "Connected" status indicator and the Settings link. It appears in both expanded and collapsed sidebar states.

### Data Source

A lightweight Anthropic API call (`messages.create` with `max_tokens: 1`) captures rate-limit response headers:

- `anthropic-ratelimit-requests-limit` / `anthropic-ratelimit-requests-remaining`
- `anthropic-ratelimit-tokens-limit` / `anthropic-ratelimit-tokens-remaining`
- `anthropic-ratelimit-requests-reset` / `anthropic-ratelimit-tokens-reset`

Usage percentage = `(1 - remaining / limit) * 100`

**API Key**: Reuses existing `pokaimon-anthropic-key` from localStorage.

### Polling Strategy

- On app launch
- Every 5 minutes in background
- When any agent finishes a task (listen to existing agent completion events)

Polling pauses when no API key is configured — widget shows a "Set API key" prompt instead.

### Visual States

**Expanded sidebar** — two horizontal progress bars stacked:

| Label    | Bar color by threshold |
|----------|----------------------|
| Session  | Green <60% · Orange 60-85% · Red >85% |
| Semaine  | Green <60% · Orange 60-85% · Red >85% |

- Percentage displayed right-aligned next to label
- Background tint matches bar color at orange/red levels (subtle)
- Font weight increases to bold at red level

**Collapsed sidebar** — two vertical mini-bars side by side (4px wide, 28px tall), fill from bottom. Tooltip on hover shows "Session: X% | Semaine: Y%".

### Colors (from Dorothy palette)

- Green: `#4A8B50` / Tailwind `text-green-600 dark:text-green-400`
- Orange: `#CD7F4A` / matches Dorothy accent/warning color
- Red: `#B85440` / matches Dorothy danger color
- Bar background: `bg-secondary` (dark: `#2a2a4a`)

### Interaction

- **Click** → opens `https://claude.ai/settings/usage` in external browser (Tauri `shell.open()`)
- **Hover** → cursor pointer, subtle highlight

### "Connected" Status

Remains above the usage widget as-is (green pulse dot + "Connected" text). No changes to its behavior.

### Edge Cases

- **No API key**: Widget hidden or shows muted "Configure API key" text linking to Settings
- **API error / network down**: Show last known values with a stale indicator (muted opacity), retry on next poll cycle
- **Rate limit headers missing**: Graceful fallback — hide the affected bar, show only what's available

## Files to Modify

| File | Change |
|------|--------|
| `src/components/Sidebar.tsx` | Add UsageWidget component in bottom section |
| `src/hooks/useUsageRate.ts` | **New** — hook for polling Anthropic API and computing percentages |
| `src/store/index.ts` | Add `usageRate` state (session%, week%, lastUpdated, error) |

## Verification

1. Set `pokaimon-anthropic-key` in localStorage
2. Verify widget appears in sidebar with real percentages
3. Collapse sidebar → verify vertical bars render correctly
4. Click widget → verify `claude.ai/settings/usage` opens in external browser
5. Remove API key → verify graceful fallback
6. Wait 5 minutes → verify auto-refresh
7. Trigger agent completion → verify refresh fires
