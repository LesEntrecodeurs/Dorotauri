# Remove Framer Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `framer-motion` dependency entirely, replacing all animations with CSS transitions + a custom `useAnimatePresence` hook.

**Architecture:** A single hook (`useAnimatePresence`) handles delayed unmount for exit animations. All visual animations are driven by CSS classes keyed on a `data-state` attribute. No component wrappers, no animation library replacement.

**Tech Stack:** React hooks, CSS transitions, `data-state` attribute selectors

**Spec:** `docs/superpowers/specs/2026-03-29-remove-framer-motion-design.md`

---

## File Structure

**New files:**
- `src/hooks/useAnimatePresence.ts` — hook for exit animation unmount delay

**Modified files:**
- `src/globals.css` — add animation utility classes
- 50 component/route files — replace framer-motion with CSS classes (listed per task)

**Removed dependencies:**
- `framer-motion` from `package.json`

---

### Task 1: Create `useAnimatePresence` hook and CSS animation classes

**Files:**
- Create: `src/hooks/useAnimatePresence.ts`
- Modify: `src/globals.css`

- [ ] **Step 1: Create the hook file**

```ts
// src/hooks/useAnimatePresence.ts
import { useState, useEffect, useCallback } from 'react';

type AnimationState = 'entering' | 'entered' | 'exiting' | 'exited';

/**
 * Replaces framer-motion's AnimatePresence.
 * Delays unmount so CSS exit transitions can play.
 *
 * @param isOpen - whether the element should be visible
 * @param duration - exit animation duration in ms (must match CSS transition-duration)
 * @returns shouldRender (mount/unmount gate) and animationState (drives data-state)
 */
export function useAnimatePresence(isOpen: boolean, duration = 150) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [animationState, setAnimationState] = useState<AnimationState>(
    isOpen ? 'entered' : 'exited'
  );

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setAnimationState('entering');
      // Double rAF: first frame renders with "entering" (initial state),
      // second frame transitions to "entered" (final state)
      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => {
          setAnimationState('entered');
        });
        // Store raf2 for cleanup
        (cleanup as any).raf2 = raf2;
      });
      const cleanup: any = { raf1 };
      return () => {
        cancelAnimationFrame(cleanup.raf1);
        if (cleanup.raf2) cancelAnimationFrame(cleanup.raf2);
      };
    } else {
      setAnimationState('exiting');
      const timer = setTimeout(() => {
        setShouldRender(false);
        setAnimationState('exited');
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isOpen, duration]);

  return { shouldRender, animationState } as const;
}
```

- [ ] **Step 2: Add CSS animation classes to globals.css**

Append after the last rule in `src/globals.css`:

```css
/* ── Animation utilities (replaces framer-motion) ─────────────────────────── */

/* Fade only */
.animate-fade {
  opacity: 0;
  transition: opacity 150ms ease;
}
.animate-fade[data-state="entered"] {
  opacity: 1;
}
.animate-fade[data-state="exiting"] {
  opacity: 0;
}

/* Fade + scale (modals, dialogs) */
.animate-modal {
  opacity: 0;
  transform: scale(0.95);
  transition: opacity 150ms ease, transform 150ms ease;
}
.animate-modal[data-state="entered"] {
  opacity: 1;
  transform: scale(1);
}
.animate-modal[data-state="exiting"] {
  opacity: 0;
  transform: scale(0.95);
}

/* Fade + slide up (lists, cards, toasts) */
.animate-slide-up {
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 150ms ease, transform 150ms ease;
}
.animate-slide-up[data-state="entered"] {
  opacity: 1;
  transform: translateY(0);
}
.animate-slide-up[data-state="exiting"] {
  opacity: 0;
  transform: translateY(8px);
}

/* Fade + slide right (side panels) */
.animate-slide-right {
  opacity: 0;
  transform: translateX(10px) scale(0.95);
  transition: opacity 150ms ease, transform 150ms ease;
}
.animate-slide-right[data-state="entered"] {
  opacity: 1;
  transform: translateX(0) scale(1);
}
.animate-slide-right[data-state="exiting"] {
  opacity: 0;
  transform: translateX(10px) scale(0.95);
}

/* Fade + slide left (activity feed items) */
.animate-slide-left {
  opacity: 0;
  transform: translateX(-20px);
  transition: opacity 200ms ease, transform 200ms ease;
}
.animate-slide-left[data-state="entered"] {
  opacity: 1;
  transform: translateX(0);
}
.animate-slide-left[data-state="exiting"] {
  opacity: 0;
  transform: translateX(20px);
}

/* Toast (slide up from bottom with scale) */
.animate-toast {
  opacity: 0;
  transform: translateY(50px) scale(0.95);
  transition: opacity 200ms ease, transform 200ms ease;
}
.animate-toast[data-state="entered"] {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.animate-toast[data-state="exiting"] {
  opacity: 0;
  transform: translateY(20px);
}

/* Expand/collapse (height: 0 → auto via grid trick) */
.animate-expand {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows 150ms ease, opacity 150ms ease;
}
.animate-expand[data-state="entered"] {
  grid-template-rows: 1fr;
  opacity: 1;
}
.animate-expand[data-state="exiting"] {
  grid-template-rows: 0fr;
  opacity: 0;
}
.animate-expand > * {
  overflow: hidden;
}

/* Panel height animation (detail panels, terminal panels) */
.animate-panel-height {
  max-height: 0;
  transition: max-height 200ms ease, opacity 200ms ease;
  opacity: 0;
  overflow: hidden;
}
.animate-panel-height[data-state="entered"] {
  max-height: 40vh;
  opacity: 1;
}
.animate-panel-height[data-state="exiting"] {
  max-height: 0;
  opacity: 0;
}

/* Notification panel width animation */
.animate-panel-width {
  transition: width 300ms cubic-bezier(0.2, 0, 0, 1);
}

/* Mount-only fade-in (no exit animation needed, one-shot) */
@keyframes mount-fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-mount-fade-up {
  animation: mount-fade-up 200ms ease both;
}

@keyframes mount-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.animate-mount-fade-in {
  animation: mount-fade-in 200ms ease both;
}

/* Staggered delay via CSS custom property */
.animate-stagger {
  animation-delay: calc(var(--stagger-index, 0) * 30ms);
}
```

- [ ] **Step 3: Verify build compiles**

Run: `cd /home/flavien/projects/Dorotoring && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no errors related to the new files

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useAnimatePresence.ts src/globals.css
git commit -m "feat: add useAnimatePresence hook and CSS animation classes

Replaces framer-motion's AnimatePresence with a lightweight hook + CSS.
Animation classes use data-state attributes for enter/exit transitions."
```

---

### Task 2: Migrate modal/dialog components (group 1 — standard pattern)

These files all share the exact same pattern: `AnimatePresence` → backdrop `motion.div` (fade) → content `motion.div` (scale+fade).

**Files:**
- Modify: `src/components/TerminalDialog.tsx`
- Modify: `src/components/PluginInstallDialog.tsx`
- Modify: `src/components/AgentList/StartPromptModal.tsx`
- Modify: `src/components/NewChatModal/SkillInstallTerminal.tsx`
- Modify: `src/components/Settings/InstallTerminalModal.tsx`

- [ ] **Step 1: Migrate `TerminalDialog.tsx`**

Replace the import:
```tsx
// REMOVE: import { motion, AnimatePresence } from 'framer-motion';
// ADD:
import { useAnimatePresence } from '@/hooks/useAnimatePresence';
```

Add hook inside the component (before the return):
```tsx
const { shouldRender, animationState } = useAnimatePresence(open);
```

Replace the JSX (the AnimatePresence/motion block starting at line ~225):
```tsx
// BEFORE:
// <AnimatePresence>
//   {open && (
//     <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
//       className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
//       <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
//         onClick={(e) => e.stopPropagation()} className="w-full max-w-4xl bg-card border border-border overflow-hidden">
//         ...content...
//       </motion.div>
//     </motion.div>
//   )}
// </AnimatePresence>

// AFTER:
{shouldRender && (
  <div
    data-state={animationState}
    className="animate-fade fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
  >
    <div
      data-state={animationState}
      className="animate-modal w-full max-w-4xl bg-card border border-border overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      ...content unchanged...
    </div>
  </div>
)}
```

- [ ] **Step 2: Migrate `PluginInstallDialog.tsx`**

Same pattern as Step 1. Replace:
- `import { motion, AnimatePresence } from 'framer-motion'` → `import { useAnimatePresence } from '@/hooks/useAnimatePresence'`
- Add `const { shouldRender, animationState } = useAnimatePresence(open);` inside component
- Replace `<AnimatePresence>{open && (<motion.div ...>` with `{shouldRender && (<div data-state={animationState} className="animate-fade ...">`
- Replace inner `<motion.div` with `<div data-state={animationState} className="animate-modal ..."`
- Remove closing `</AnimatePresence>`

- [ ] **Step 3: Migrate `AgentList/StartPromptModal.tsx`**

Same pattern. The prop controlling visibility may be named differently (check the component's open/show prop). Apply identical transformation as Step 1.

- [ ] **Step 4: Migrate `NewChatModal/SkillInstallTerminal.tsx`**

Same pattern. Replace AnimatePresence + motion.div with useAnimatePresence + data-state divs.

- [ ] **Step 5: Migrate `Settings/InstallTerminalModal.tsx`**

Same pattern.

- [ ] **Step 6: Verify build compiles**

Run: `cd /home/flavien/projects/Dorotoring && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no type errors

- [ ] **Step 7: Commit**

```bash
git add src/components/TerminalDialog.tsx src/components/PluginInstallDialog.tsx src/components/AgentList/StartPromptModal.tsx src/components/NewChatModal/SkillInstallTerminal.tsx src/components/Settings/InstallTerminalModal.tsx
git commit -m "refactor: migrate modal dialogs (group 1) from framer-motion to CSS

TerminalDialog, PluginInstallDialog, StartPromptModal,
SkillInstallTerminal, InstallTerminalModal"
```

---

### Task 3: Migrate modal/dialog components (group 2 — route-level modals)

**Files:**
- Modify: `src/routes/sftp-hosts.tsx`
- Modify: `src/routes/hosts.tsx`
- Modify: `src/components/RecurringTasks/components/CreateTaskModal.tsx`
- Modify: `src/components/RecurringTasks/components/EditTaskModal.tsx`
- Modify: `src/components/RecurringTasks/components/LogsModal.tsx`

- [ ] **Step 1: Migrate `sftp-hosts.tsx`**

This file has multiple modal patterns (add/edit/delete confirmations) and a card with `layout` + slide-up animation.

For each modal in the file:
- Replace `import { motion, AnimatePresence } from 'framer-motion'` → `import { useAnimatePresence } from '@/hooks/useAnimatePresence'`
- For each modal controlled by a boolean state (e.g., `showAddModal`, `showEditModal`, `showDeleteConfirm`), create a corresponding `useAnimatePresence` call:
  ```tsx
  const addModalAnim = useAnimatePresence(showAddModal);
  const editModalAnim = useAnimatePresence(showEditModal);
  const deleteModalAnim = useAnimatePresence(showDeleteConfirm);
  ```
- Replace each `<AnimatePresence>{show && (<motion.div ...>` block with `{anim.shouldRender && (<div data-state={anim.animationState} className="animate-fade ...">` + inner `animate-modal` div.

For the `SftpHostCard` component which uses `<motion.div layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>`:
- Replace with `<div className="animate-mount-fade-up">` (mount-only animation, no exit needed, drop `layout` prop)

- [ ] **Step 2: Migrate `hosts.tsx`**

Identical structure to `sftp-hosts.tsx`. Apply the same transformations.

- [ ] **Step 3: Migrate `RecurringTasks/CreateTaskModal.tsx`**

Standard modal pattern. Replace AnimatePresence + motion.div with useAnimatePresence + CSS classes.

- [ ] **Step 4: Migrate `RecurringTasks/EditTaskModal.tsx`**

Same pattern as Step 3.

- [ ] **Step 5: Migrate `RecurringTasks/LogsModal.tsx`**

Same pattern as Step 3.

- [ ] **Step 6: Verify build compiles**

Run: `cd /home/flavien/projects/Dorotoring && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no type errors

- [ ] **Step 7: Commit**

```bash
git add src/routes/sftp-hosts.tsx src/routes/hosts.tsx src/components/RecurringTasks/components/CreateTaskModal.tsx src/components/RecurringTasks/components/EditTaskModal.tsx src/components/RecurringTasks/components/LogsModal.tsx
git commit -m "refactor: migrate modal dialogs (group 2) from framer-motion to CSS

sftp-hosts, hosts, CreateTaskModal, EditTaskModal, LogsModal"
```

---

### Task 4: Migrate large modal dialogs (NewChatModal, AgentTerminalDialog, KanbanBoard modals)

**Files:**
- Modify: `src/components/NewChatModal/index.tsx`
- Modify: `src/components/NewChatModal/StepTask.tsx`
- Modify: `src/components/AgentTerminalDialog/index.tsx`
- Modify: `src/components/KanbanBoard/components/NewTaskModal.tsx`
- Modify: `src/components/KanbanBoard/components/KanbanCardDetail.tsx`
- Modify: `src/components/KanbanBoard/components/KanbanDoneSummary.tsx`

- [ ] **Step 1: Migrate `NewChatModal/index.tsx`**

Replace framer-motion import with useAnimatePresence import. The modal uses `scale: 0.9` (slightly different from the standard 0.95). The CSS `.animate-modal` class uses `scale(0.95)` which is close enough — use it.

- Add `const { shouldRender, animationState } = useAnimatePresence(open);`
- Replace outer `motion.div` (backdrop) with `<div data-state={animationState} className="animate-fade ...">`
- Replace inner `motion.div` (content) with `<div data-state={animationState} className="animate-modal ...">`

- [ ] **Step 2: Migrate `NewChatModal/StepTask.tsx`**

This uses AnimatePresence for a collapsible task details section. Replace:
- `motion.div` with expand/collapse → use `useAnimatePresence` + `animate-expand` class
- Inner `motion.div` (progress bar) uses `initial={{ width: 0 }} animate={{ width: ... }}` → replace with a plain `div` using inline `style={{ width: \`\${progress}%\`, transition: 'width 500ms ease' }}`

- [ ] **Step 3: Migrate `AgentTerminalDialog/index.tsx`**

Standard modal pattern (backdrop + content scale). Apply useAnimatePresence + CSS classes.

- [ ] **Step 4: Migrate `KanbanBoard/NewTaskModal.tsx`**

Standard modal pattern. Apply useAnimatePresence + CSS classes.

- [ ] **Step 5: Migrate `KanbanBoard/KanbanCardDetail.tsx`**

Standard modal pattern. Apply useAnimatePresence + CSS classes.

- [ ] **Step 6: Migrate `KanbanBoard/KanbanDoneSummary.tsx`**

Standard modal pattern. Apply useAnimatePresence + CSS classes.

- [ ] **Step 7: Verify build compiles**

Run: `cd /home/flavien/projects/Dorotoring && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no type errors

- [ ] **Step 8: Commit**

```bash
git add src/components/NewChatModal/index.tsx src/components/NewChatModal/StepTask.tsx src/components/AgentTerminalDialog/index.tsx src/components/KanbanBoard/components/NewTaskModal.tsx src/components/KanbanBoard/components/KanbanCardDetail.tsx src/components/KanbanBoard/components/KanbanDoneSummary.tsx
git commit -m "refactor: migrate large modal dialogs from framer-motion to CSS

NewChatModal, StepTask, AgentTerminalDialog, NewTaskModal,
KanbanCardDetail, KanbanDoneSummary"
```

---

### Task 5: Migrate route-level pages (projects, memory, plugins, settings, skills, automations)

**Files:**
- Modify: `src/routes/projects.tsx`
- Modify: `src/routes/memory.tsx`
- Modify: `src/routes/plugins.tsx`
- Modify: `src/routes/settings.tsx`
- Modify: `src/routes/skills.tsx`
- Modify: `src/routes/automations.tsx`

- [ ] **Step 1: Migrate `projects.tsx`**

This file uses motion.div for multiple UI elements (panels, modals, cards). For each:
- Modal patterns → `useAnimatePresence` + `animate-fade` / `animate-modal`
- Mount-only card animations → `animate-mount-fade-up`
- Replace `import { motion, AnimatePresence } from 'framer-motion'` with `import { useAnimatePresence } from '@/hooks/useAnimatePresence'`

- [ ] **Step 2: Migrate `memory.tsx`**

Has a modal dialog and some mount-only fade-in cards. Apply standard patterns.

- [ ] **Step 3: Migrate `plugins.tsx`**

Has multiple panels with enter/exit animations. Apply useAnimatePresence for each visible/hidden state.

- [ ] **Step 4: Migrate `settings.tsx`**

Simple motion.div with fade-in. Replace with `animate-mount-fade-up` or `animate-fade` as appropriate.

- [ ] **Step 5: Migrate `skills.tsx`**

Panel animations. Apply useAnimatePresence + CSS classes.

- [ ] **Step 6: Migrate `automations.tsx`**

Has modals and detail panels. Apply useAnimatePresence + CSS classes.

- [ ] **Step 7: Verify build compiles**

Run: `cd /home/flavien/projects/Dorotoring && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no type errors

- [ ] **Step 8: Commit**

```bash
git add src/routes/projects.tsx src/routes/memory.tsx src/routes/plugins.tsx src/routes/settings.tsx src/routes/skills.tsx src/routes/automations.tsx
git commit -m "refactor: migrate route pages from framer-motion to CSS

projects, memory, plugins, settings, skills, automations"
```

---

### Task 6: Migrate Dashboard components

**Files:**
- Modify: `src/components/Dashboard/StatsCard.tsx`
- Modify: `src/components/Dashboard/ProjectsOverview.tsx`
- Modify: `src/components/Dashboard/AgentActivity.tsx`
- Modify: `src/components/Dashboard/TerminalLog.tsx`
- Modify: `src/components/Dashboard/LiveActivityFeed.tsx`
- Modify: `src/components/Dashboard/LiveTaskFeed.tsx`

- [ ] **Step 1: Migrate `StatsCard.tsx`**

Uses mount-only `initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}`. Replace:
- Remove framer-motion import
- Replace `<motion.div initial={...} animate={...}>` with `<div className="animate-mount-fade-up">`

- [ ] **Step 2: Migrate `ProjectsOverview.tsx`**

Same mount-only pattern. Replace motion.div with `animate-mount-fade-up` div.

- [ ] **Step 3: Migrate `AgentActivity.tsx`**

Same mount-only pattern. Replace motion.div with `animate-mount-fade-up` div. Inner progress bar `motion.div` with animated width → replace with `<div style={{ width: \`\${value}%\`, transition: 'width 500ms ease' }}>`.

- [ ] **Step 4: Migrate `TerminalLog.tsx`**

Uses AnimatePresence with list items that have enter/exit. Replace:
- Import `useAnimatePresence` (though for list items we can just use `animate-mount-fade-up` since exit animations on scrolling log items aren't critical)
- Replace `<motion.div key={...} initial={...} animate={...} exit={...}>` with `<div className="animate-mount-fade-up">`
- Remove `AnimatePresence` wrapper (or keep empty fragment)

- [ ] **Step 5: Migrate `LiveActivityFeed.tsx`**

Uses `AnimatePresence mode="popLayout"` with staggered delays (`transition={{ delay: index * 0.03 }}`). Replace:
- Remove AnimatePresence wrapper
- Replace `<motion.div key={...} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ delay: index * 0.03 }}>` with:
  ```tsx
  <div className="animate-mount-fade-up animate-stagger" style={{ '--stagger-index': index } as React.CSSProperties}>
  ```

- [ ] **Step 6: Migrate `LiveTaskFeed.tsx`**

Similar staggered pattern. Apply same approach as Step 5.

- [ ] **Step 7: Verify build compiles**

Run: `cd /home/flavien/projects/Dorotoring && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no type errors

- [ ] **Step 8: Commit**

```bash
git add src/components/Dashboard/StatsCard.tsx src/components/Dashboard/ProjectsOverview.tsx src/components/Dashboard/AgentActivity.tsx src/components/Dashboard/TerminalLog.tsx src/components/Dashboard/LiveActivityFeed.tsx src/components/Dashboard/LiveTaskFeed.tsx
git commit -m "refactor: migrate Dashboard components from framer-motion to CSS

StatsCard, ProjectsOverview, AgentActivity, TerminalLog,
LiveActivityFeed, LiveTaskFeed"
```

---

### Task 7: Migrate VaultView components

**Files:**
- Modify: `src/components/VaultView/index.tsx`
- Modify: `src/components/VaultView/components/DocumentEditor.tsx`
- Modify: `src/components/VaultView/components/DocumentList.tsx`
- Modify: `src/components/VaultView/components/FolderTree.tsx`
- Modify: `src/components/VaultView/components/SearchResults.tsx`

- [ ] **Step 1: Migrate `VaultView/index.tsx`**

Has multiple panels with motion.div. Check each one:
- Modal overlays → `useAnimatePresence` + `animate-fade` / `animate-modal`
- Mount-only panels → `animate-mount-fade-up`

- [ ] **Step 2: Migrate `DocumentEditor.tsx`**

Mount-only motion.div → `animate-mount-fade-up`.

- [ ] **Step 3: Migrate `DocumentList.tsx`**

List items with motion.button. Replace `<motion.button initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>` with `<button className="animate-mount-fade-up">`.

- [ ] **Step 4: Migrate `FolderTree.tsx`**

Uses AnimatePresence with `height: 0 → auto` for folder expand/collapse. Replace:
- Import `useAnimatePresence`
- For each folder's expandable content:
  ```tsx
  // BEFORE:
  // <AnimatePresence>
  //   {expanded && hasContent && (
  //     <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
  //       exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }}>
  //       ...children...
  //     </motion.div>
  //   )}
  // </AnimatePresence>

  // AFTER (inside FolderNode component):
  const expandAnim = useAnimatePresence(expanded && hasContent);
  // ...
  {expandAnim.shouldRender && (
    <div data-state={expandAnim.animationState} className="animate-expand">
      <div>
        ...children...
      </div>
    </div>
  )}
  ```

- [ ] **Step 5: Migrate `SearchResults.tsx`**

List items with motion.button. Same as DocumentList — replace with `animate-mount-fade-up`.

- [ ] **Step 6: Verify build compiles**

Run: `cd /home/flavien/projects/Dorotoring && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no type errors

- [ ] **Step 7: Commit**

```bash
git add src/components/VaultView/index.tsx src/components/VaultView/components/DocumentEditor.tsx src/components/VaultView/components/DocumentList.tsx src/components/VaultView/components/FolderTree.tsx src/components/VaultView/components/SearchResults.tsx
git commit -m "refactor: migrate VaultView components from framer-motion to CSS

VaultView index, DocumentEditor, DocumentList, FolderTree, SearchResults"
```

---

### Task 8: Migrate KanbanBoard components

**Files:**
- Modify: `src/components/KanbanBoard/index.tsx`
- Modify: `src/components/KanbanBoard/components/KanbanColumn.tsx`
- Modify: `src/components/KanbanBoard/components/KanbanCard.tsx`

- [ ] **Step 1: Migrate `KanbanBoard/index.tsx`**

Only imports AnimatePresence — remove the import entirely. Check if AnimatePresence wraps anything; if so, replace with a fragment or remove.

- [ ] **Step 2: Migrate `KanbanColumn.tsx`**

Uses `AnimatePresence mode="popLayout"` for card reordering. Since we're dropping layout animations:
- Remove `AnimatePresence` wrapper — just render the cards directly
- The empty state `<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>` → `<div className="animate-mount-fade-in">`
- The drop indicator `<motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 60 }}>` → `<div className="border-2 border-dashed border-primary/30 rounded-md bg-primary/5" style={{ height: 60 }}>` (no animation needed for a transient indicator)

- [ ] **Step 3: Migrate `KanbanCard.tsx`**

Uses `<motion.div layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>`. Replace:
- Drop `layout` prop
- Replace `<motion.div ...>` with `<div className="animate-mount-fade-up">`
- Inner progress bar `<motion.div initial={{ width: 0 }} animate={{ width: ... }}>` → `<div style={{ width: \`\${progress}%\`, transition: 'width 500ms ease' }}>`

- [ ] **Step 4: Verify build compiles**

Run: `cd /home/flavien/projects/Dorotoring && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no type errors

- [ ] **Step 5: Commit**

```bash
git add src/components/KanbanBoard/index.tsx src/components/KanbanBoard/components/KanbanColumn.tsx src/components/KanbanBoard/components/KanbanCard.tsx
git commit -m "refactor: migrate KanbanBoard components from framer-motion to CSS

KanbanBoard index, KanbanColumn, KanbanCard"
```

---

### Task 9: Migrate CanvasView components

**Files:**
- Modify: `src/components/CanvasView/index.tsx`
- Modify: `src/components/CanvasView/components/NotificationPanel.tsx`
- Modify: `src/components/CanvasView/components/AgentNodeCard.tsx`
- Modify: `src/components/CanvasView/components/ProjectNodeCard.tsx`
- Modify: `src/components/CanvasView/components/StatusIndicator.tsx`
- Modify: `src/components/CanvasView/components/ConnectionLine.tsx`
- Modify: `src/components/CanvasView/components/DotGrid.tsx`

- [ ] **Step 1: Migrate `CanvasView/index.tsx`**

Only imports AnimatePresence — remove the import. Remove any AnimatePresence wrapper.

- [ ] **Step 2: Migrate `NotificationPanel.tsx`**

This is the most complex case. It uses `layoutId`, `LayoutGroup`, animated `width`, and spring transitions.

Replace the outer `motion.div` (animated width):
```tsx
// BEFORE:
// <motion.div className="absolute top-4 bottom-4 right-4 z-50 flex"
//   initial={false} animate={{ width: isCollapsed ? 48 : 320 }}
//   transition={{ type: 'spring', stiffness: 300, damping: 30 }}>

// AFTER:
<div
  className="absolute top-4 bottom-4 right-4 z-50 flex animate-panel-width"
  style={{ width: isCollapsed ? 48 : 320 }}
>
```

Replace `AgentItem`'s `motion.div`:
```tsx
// BEFORE:
// <motion.div layoutId={`notification-agent-${agent.id}`}
//   initial={false} animate={{ opacity: 1, x: 0 }}
//   transition={{ type: 'spring', stiffness: 500, damping: 40 }} className={cn(...)}>

// AFTER: (drop layoutId, just a plain div)
<div className={cn(...)}>
```

Replace inner panel `AnimatePresence` + `motion.div`:
- Use `useAnimatePresence(isCollapsed === false)` for the panel content
- Replace `motion.div` with `<div data-state={animationState} className="animate-fade ...">`

Remove `LayoutGroup` — replace with a fragment.

- [ ] **Step 3: Migrate `AgentNodeCard.tsx`**

Uses motion.div with enter/exit for status indicators. Replace:
- Outer card: mount-only → `animate-mount-fade-up`
- AnimatePresence for expandable sections → `useAnimatePresence` + `animate-expand`

- [ ] **Step 4: Migrate `ProjectNodeCard.tsx`**

Same pattern as AgentNodeCard. Mount-only + expandable sections.

- [ ] **Step 5: Migrate `StatusIndicator.tsx`**

Uses motion.div for pulsing/animated indicators. Replace:
- Static status indicators → plain divs with CSS animation classes
- Pulsing animation → use existing Tailwind `animate-pulse` or `animate-ping`

- [ ] **Step 6: Migrate `ConnectionLine.tsx`**

Uses `motion.path` for SVG line animation. Replace:
- `<motion.path initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}>` → `<path className="animate-mount-fade-in">` (simpler, pathLength animation isn't critical)

- [ ] **Step 7: Migrate `DotGrid.tsx`**

Uses motion.div for mount animation. Replace with `animate-mount-fade-in`.

- [ ] **Step 8: Verify build compiles**

Run: `cd /home/flavien/projects/Dorotoring && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no type errors

- [ ] **Step 9: Commit**

```bash
git add src/components/CanvasView/index.tsx src/components/CanvasView/components/NotificationPanel.tsx src/components/CanvasView/components/AgentNodeCard.tsx src/components/CanvasView/components/ProjectNodeCard.tsx src/components/CanvasView/components/StatusIndicator.tsx src/components/CanvasView/components/ConnectionLine.tsx src/components/CanvasView/components/DotGrid.tsx
git commit -m "refactor: migrate CanvasView components from framer-motion to CSS

NotificationPanel (width + layoutId → CSS), AgentNodeCard,
ProjectNodeCard, StatusIndicator, ConnectionLine, DotGrid"
```

---

### Task 10: Migrate remaining components

**Files:**
- Modify: `src/components/TerminalsView/components/Sidebar.tsx`
- Modify: `src/components/TerminalsView/components/BroadcastIndicator.tsx`
- Modify: `src/components/NotificationToast.tsx`
- Modify: `src/components/RecurringTasks/components/TaskCard.tsx`
- Modify: `src/components/RecurringTasks/components/Toast.tsx`
- Modify: `src/components/ProjectDocs/DocSearchModal.tsx`
- Modify: `src/routes/docker.tsx`

- [ ] **Step 1: Migrate `TerminalsView/Sidebar.tsx`**

Uses AnimatePresence with slide-right animation (`x: 10, scale: 0.95`). Replace:
```tsx
import { useAnimatePresence } from '@/hooks/useAnimatePresence';
// ...
const { shouldRender, animationState } = useAnimatePresence(open);
// ...
{shouldRender && (
  <div
    ref={panelRef}
    data-state={animationState}
    className="animate-slide-right absolute top-0 right-0 z-50 flex flex-col bg-card border border-border shadow-2xl overflow-hidden"
    style={{ width: 300, maxHeight: 'calc(100% - 32px)' }}
  >
    ...content unchanged...
  </div>
)}
```

- [ ] **Step 2: Migrate `BroadcastIndicator.tsx`**

Uses AnimatePresence for a small indicator. Replace with useAnimatePresence + animate-fade.

- [ ] **Step 3: Migrate `NotificationToast.tsx`**

Uses AnimatePresence with toast animation (slide-up-from-bottom + scale). Replace:
```tsx
import { useAnimatePresence } from '@/hooks/useAnimatePresence';
// ...
const toastAnim = useAnimatePresence(!!latest, 200);
// ...
{toastAnim.shouldRender && latest && (
  <div
    data-state={toastAnim.animationState}
    className="animate-toast fixed bottom-4 right-4 z-50 max-w-sm"
  >
    <Card className="shadow-lg overflow-hidden">
      ...content unchanged...
    </Card>
  </div>
)}
```

- [ ] **Step 4: Migrate `RecurringTasks/TaskCard.tsx`**

Mount-only animation. Replace motion.div with `animate-mount-fade-up`.

- [ ] **Step 5: Migrate `RecurringTasks/Toast.tsx`**

Toast animation. Apply same pattern as NotificationToast.

- [ ] **Step 6: Migrate `ProjectDocs/DocSearchModal.tsx`**

Standard modal pattern. Apply useAnimatePresence + animate-fade/animate-modal.

- [ ] **Step 7: Migrate `docker.tsx`**

Multiple patterns:
- `ContainerRow`: uses `layout` + `initial={{ opacity: 0, y: 4 }}`. Replace `<motion.div layout ...>` with `<div className="animate-mount-fade-up">`. Drop `layout` and `exit` props.
- `ProjectSection`: outer `<motion.div layout ...>` → `<div className="animate-mount-fade-up ...">`. Inner `AnimatePresence` for container list expand → `useAnimatePresence(expanded)` + `animate-expand`.
- `DetailPanel`: `<motion.div initial={{ height: 0 }} animate={{ height: '40%' }} exit={{ height: 0 }}>` → `useAnimatePresence` + `animate-panel-height`.
- `DockerTerminalPanel`: same as DetailPanel.

- [ ] **Step 8: Verify build compiles**

Run: `cd /home/flavien/projects/Dorotoring && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no type errors

- [ ] **Step 9: Commit**

```bash
git add src/components/TerminalsView/components/Sidebar.tsx src/components/TerminalsView/components/BroadcastIndicator.tsx src/components/NotificationToast.tsx src/components/RecurringTasks/components/TaskCard.tsx src/components/RecurringTasks/components/Toast.tsx src/components/ProjectDocs/DocSearchModal.tsx src/routes/docker.tsx
git commit -m "refactor: migrate remaining components from framer-motion to CSS

TerminalsView Sidebar, BroadcastIndicator, NotificationToast,
RecurringTasks TaskCard/Toast, DocSearchModal, Docker"
```

---

### Task 11: Remove framer-motion dependency and final verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Verify no framer-motion imports remain**

Run: `grep -r "framer-motion" src/ --include="*.tsx" --include="*.ts" -l`
Expected: no output (no files)

- [ ] **Step 2: Remove framer-motion from package.json**

Run: `npm uninstall framer-motion` (or `pnpm remove framer-motion` depending on package manager)

- [ ] **Step 3: Verify full build compiles**

Run: `cd /home/flavien/projects/Dorotoring && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: zero errors

- [ ] **Step 4: Verify dev server starts**

Run: `cd /home/flavien/projects/Dorotoring && npm run dev` (or appropriate dev command)
Expected: starts without errors

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove framer-motion dependency

Replaced with CSS animations + useAnimatePresence hook.
Removes ~50KB from JS bundle."
```
