import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAnimatePresence } from '@/hooks/useAnimatePresence';
import { Search, Loader2, FileText } from 'lucide-react';

interface DocSearchResult {
  filePath: string;
  relative: string;
  fileName: string;
  lineNumber: number;
  lineContent: string;
}

interface DocSearchModalProps {
  projectPath: string;
  open: boolean;
  onClose: () => void;
  onSelect: (filePath: string, lineNumber: number) => void;
}

export function DocSearchModal({ projectPath, open, onClose, onSelect }: DocSearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DocSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!query.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await invoke<DocSearchResult[]>('project_search_docs', {
          projectPath,
          query: query.trim(),
        });
        setResults(res);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [query, projectPath]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      const result = results[selectedIndex];
      if (result) {
        onSelect(result.filePath, result.lineNumber);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [results, selectedIndex, onSelect, onClose]);

  const { shouldRender, animationState } = useAnimatePresence(open);

  // Group results by file for display, tracking global indices
  const grouped = useMemo(() => {
    const groups: { relative: string; startIndex: number; items: DocSearchResult[] }[] = [];
    let currentRelative = '';
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.relative !== currentRelative) {
        currentRelative = r.relative;
        groups.push({ relative: r.relative, startIndex: i, items: [r] });
      } else {
        groups[groups.length - 1].items.push(r);
      }
    }
    return groups;
  }, [results]);

  if (!shouldRender) return null;

  return (
    <div
      data-state={animationState}
      className="animate-fade fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        data-state={animationState}
        className="animate-modal w-[80%] max-w-4xl h-[70vh] bg-card border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            {isSearching ? (
              <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
            ) : (
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Grep in documents..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
            {results.length > 0 && (
              <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                {results.length} match{results.length !== 1 ? 'es' : ''}
              </span>
            )}
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto" ref={listRef}>
            {!query.trim() ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                <Search className="w-8 h-8 opacity-15" />
                <p className="text-xs">Type to search across all documents</p>
              </div>
            ) : results.length === 0 && !isSearching ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                <FileText className="w-8 h-8 opacity-15" />
                <p className="text-xs">No results</p>
              </div>
            ) : (
              <div>
                {grouped.map((group) => (
                  <div key={group.relative}>
                    <div className="px-4 py-1.5 text-[10px] font-mono text-muted-foreground bg-muted/40 sticky top-0 border-b border-border/50">
                      <FileText className="w-3 h-3 inline-block mr-1.5 -mt-0.5" />
                      {group.relative}
                    </div>
                    {group.items.map((result, idx) => {
                      const globalIndex = group.startIndex + idx;
                      const isSelected = globalIndex === selectedIndex;
                      return (
                        <button
                          key={`${result.lineNumber}:${idx}`}
                          data-index={globalIndex}
                          onClick={() => {
                            onSelect(result.filePath, result.lineNumber);
                            onClose();
                          }}
                          onMouseEnter={() => setSelectedIndex(globalIndex)}
                          className={`w-full text-left px-4 py-1 flex items-center gap-3 text-xs font-mono transition-colors ${
                            isSelected
                              ? 'bg-primary/15 text-foreground'
                              : 'text-muted-foreground hover:bg-muted/30'
                          }`}
                        >
                          <span className={`text-[10px] shrink-0 min-w-[3.5rem] text-right tabular-nums ${
                            isSelected ? 'text-primary' : 'text-primary/50'
                          }`}>
                            {result.lineNumber}
                          </span>
                          <span className="truncate">
                            {highlightMatch(result.lineContent, query)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer keyboard hints */}
          <div className="flex items-center gap-5 px-4 py-2 border-t border-border bg-muted/30 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[9px] font-mono">↑↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[9px] font-mono">↵</kbd>
              Open
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[9px] font-mono">Esc</kbd>
              Close
            </span>
          </div>
      </div>
    </div>
  );
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <span key={i} className="text-foreground bg-primary/25 px-0.5 rounded-sm">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
