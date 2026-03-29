import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';

interface DocFindBarProps {
  open: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clearMarks(container: HTMLElement) {
  container.querySelectorAll('mark[data-doc-find]').forEach((mark) => {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
      parent.normalize();
    }
  });
}

function applyMarks(container: HTMLElement, query: string): HTMLElement[] {
  const matches: HTMLElement[] = [];
  if (!query) return matches;

  const regex = new RegExp(escapeRegExp(query), 'gi');
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: { node: Text; nodeMatches: { start: number; end: number }[] }[] = [];

  let current = walker.nextNode() as Text | null;
  while (current) {
    const text = current.textContent || '';
    const nodeMatches: { start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text))) {
      nodeMatches.push({ start: m.index, end: m.index + m[0].length });
    }
    if (nodeMatches.length > 0) {
      textNodes.push({ node: current, nodeMatches });
    }
    current = walker.nextNode() as Text | null;
  }

  // Process in reverse order to preserve DOM positions
  for (let i = textNodes.length - 1; i >= 0; i--) {
    const { node, nodeMatches } = textNodes[i];
    const text = node.textContent || '';
    const parent = node.parentNode;
    if (!parent) continue;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;

    for (const { start, end } of nodeMatches) {
      if (start > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }
      const mark = document.createElement('mark');
      mark.setAttribute('data-doc-find', '');
      mark.textContent = text.slice(start, end);
      mark.className = 'bg-yellow-400/40 rounded-sm';
      matches.push(mark);
      fragment.appendChild(mark);
      lastIndex = end;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    parent.replaceChild(fragment, node);
  }

  // We processed in reverse, so reverse matches to get correct order
  matches.reverse();
  return matches;
}

export function DocFindBar({ open, onClose, containerRef }: DocFindBarProps) {
  const [query, setQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const matchesRef = useRef<HTMLElement[]>([]);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setMatchCount(0);
      setActiveIndex(0);
      matchesRef.current = [];
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      // Clear marks when closing
      if (containerRef.current) {
        clearMarks(containerRef.current);
      }
    }
  }, [open, containerRef]);

  // Apply highlighting when query changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !open) return;

    clearMarks(container);

    if (!query.trim()) {
      matchesRef.current = [];
      setMatchCount(0);
      setActiveIndex(0);
      return;
    }

    const marks = applyMarks(container, query.trim());
    matchesRef.current = marks;
    setMatchCount(marks.length);
    setActiveIndex(marks.length > 0 ? 0 : -1);

    // Highlight first match
    if (marks.length > 0) {
      marks[0].className = 'bg-orange-400/80 rounded-sm ring-1 ring-orange-500/50';
      marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [query, open, containerRef]);

  const goToMatch = useCallback((index: number) => {
    const marks = matchesRef.current;
    if (marks.length === 0) return;

    const wrapped = ((index % marks.length) + marks.length) % marks.length;

    // Reset all marks
    marks.forEach((m) => {
      m.className = 'bg-yellow-400/40 rounded-sm';
    });

    // Highlight active
    marks[wrapped].className = 'bg-orange-400/80 rounded-sm ring-1 ring-orange-500/50';
    marks[wrapped].scrollIntoView({ behavior: 'smooth', block: 'center' });
    setActiveIndex(wrapped);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        goToMatch(activeIndex - 1);
      } else {
        goToMatch(activeIndex + 1);
      }
    } else if (e.key === 'F3' || (e.key === 'g' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      if (e.shiftKey) {
        goToMatch(activeIndex - 1);
      } else {
        goToMatch(activeIndex + 1);
      }
    }
  }, [onClose, goToMatch, activeIndex]);

  if (!open) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/50 shrink-0">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in document..."
        className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
      />
      {query.trim() && (
        <span className="text-[10px] text-muted-foreground font-mono shrink-0 tabular-nums">
          {matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : 'No results'}
        </span>
      )}
      <button
        onClick={() => goToMatch(activeIndex - 1)}
        disabled={matchCount === 0}
        className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        title="Previous (Shift+Enter)"
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => goToMatch(activeIndex + 1)}
        disabled={matchCount === 0}
        className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        title="Next (Enter)"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onClose}
        className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
        title="Close (Escape)"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
