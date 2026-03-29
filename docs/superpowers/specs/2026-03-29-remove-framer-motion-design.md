# Remove Framer Motion — Migrate to CSS Animations

## Context

Framer Motion v12.29 is used across ~50 files in the project. The actual animations are simple: fade, scale, slide, and expand/collapse. The library adds 5.3 MB to node_modules and ~50 KB to the JS bundle for functionality that CSS handles natively.

## Goals

- Remove the `framer-motion` dependency entirely
- Replace all animations with CSS transitions driven by `data-state` attributes
- Provide a `useAnimatePresence` hook for exit animations (the one feature CSS can't do alone)
- Improve performance by leveraging GPU-accelerated CSS transitions

## Design

### Hook: `useAnimatePresence`

A custom hook (~25 lines) that replaces `AnimatePresence`. It delays unmounting a component until its CSS exit animation completes.

**File:** `src/hooks/useAnimatePresence.ts`

```tsx
function useAnimatePresence(isOpen: boolean, duration = 150) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [animationState, setAnimationState] = useState<
    'entering' | 'entered' | 'exiting' | 'exited'
  >(isOpen ? 'entered' : 'exited');

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setAnimationState('entering');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimationState('entered'));
      });
    } else {
      setAnimationState('exiting');
      const timer = setTimeout(() => {
        setShouldRender(false);
        setAnimationState('exited');
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isOpen, duration]);

  return { shouldRender, animationState };
}
```

**Usage pattern:**
```tsx
const { shouldRender, animationState } = useAnimatePresence(isOpen);
return shouldRender ? (
  <div data-state={animationState} className="animate-modal">...</div>
) : null;
```

### CSS Animation Classes

Added to `src/globals.css`. All driven by `data-state` attribute.

**`.animate-fade`** — simple opacity transition
```css
.animate-fade {
  transition: opacity 150ms ease;
  opacity: 0;
}
.animate-fade[data-state="entered"] { opacity: 1; }
.animate-fade[data-state="exiting"] { opacity: 0; }
```

**`.animate-modal`** — fade + scale (modals, dialogs)
```css
.animate-modal {
  transition: opacity 150ms ease, transform 150ms ease;
  opacity: 0;
  transform: scale(0.95);
}
.animate-modal[data-state="entered"] { opacity: 1; transform: scale(1); }
.animate-modal[data-state="exiting"] { opacity: 0; transform: scale(0.95); }
```

**`.animate-slide-up`** — fade + translateY (lists, cards, toasts)
```css
.animate-slide-up {
  transition: opacity 150ms ease, transform 150ms ease;
  opacity: 0;
  transform: translateY(4px);
}
.animate-slide-up[data-state="entered"] { opacity: 1; transform: translateY(0); }
.animate-slide-up[data-state="exiting"] { opacity: 0; transform: translateY(4px); }
```

**`.animate-expand`** — height animation (accordions, expandable sections)
```css
.animate-expand {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 150ms ease;
}
.animate-expand[data-state="entered"] { grid-template-rows: 1fr; }
.animate-expand > * { overflow: hidden; }
```

### Migration Patterns

Three categories of replacements, all mechanical:

**1. Modals/Dialogs (AnimatePresence + overlay + content)**

Before:
```tsx
<AnimatePresence>
  {isOpen && (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}>
        ...
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>
```

After:
```tsx
const { shouldRender, animationState } = useAnimatePresence(isOpen);
{shouldRender && (
  <div data-state={animationState} className="animate-fade">
    <div data-state={animationState} className="animate-modal">
      ...
    </div>
  </div>
)}
```

**2. List items / Cards (fade + slide)**

Before:
```tsx
<motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
```

After:
```tsx
<div data-state="entered" className="animate-slide-up">
```

For items that are always visible (no exit animation needed), `data-state="entered"` can be set directly. The CSS transition from the initial state handles the enter animation on mount via the double-rAF pattern or a simple `useEffect`.

**3. Expand/Collapse (Docker containers, etc.)**

Before:
```tsx
<motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}>
```

After:
```tsx
<div data-state={animationState} className="animate-expand">
  <div>...</div>
</div>
```

### Files Modified

- **New:** `src/hooks/useAnimatePresence.ts`
- **Modified:** `src/globals.css` (add animation utility classes)
- **Modified:** ~50 component/route files (remove framer-motion imports, replace motion.div with CSS classes)
- **Removed:** `framer-motion` from `package.json`

### Migration Strategy

Big bang approach — all files migrated in one pass:

1. Create `useAnimatePresence` hook and CSS classes
2. Migrate modals/dialogs (~30 files)
3. Migrate list items/cards (~15 files)
4. Migrate expand/collapse (~3 files)
5. Remove `framer-motion` from package.json
6. Verify build compiles and app runs correctly

### What We're Not Doing

- No `layout` animation replacement — not needed currently, can revisit with FLIP technique if needed later
- No animation library replacement (motion-one, etc.) — CSS is sufficient
- No component wrapper abstraction — the hook + CSS classes are enough
