import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileText, Bot, ArrowLeft, Loader2, FolderOpen, Search, Copy, Check, GitBranch, RefreshCw } from 'lucide-react';
import { DocFileTree } from './DocFileTree';
import type { DocEntry } from './DocFileTree';
import { SimpleMarkdown } from '@/components/VaultView/components/MarkdownRenderer';
import { DocSearchModal } from './DocSearchModal';
import { DocFindBar } from './DocFindBar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DiffFileTree } from './DiffFileTree';
import { DiffViewer } from './DiffViewer';
import { useDiffData } from './useDiffData';

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
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const isResizing = useRef(false);
  const [targetLine, setTargetLine] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<string>('docs');
  const {
    changedFiles,
    selectedFile,
    fileDiff,
    diffMode,
    setDiffMode,
    selectFile,
    refresh: refreshDiff,
    loading: loadingDiff,
    loadingDiff: loadingFileDiff,
  } = useDiffData(projectPath, activeTab === 'modifications');

  // Ctrl+F → in-document find, Ctrl+Shift+F → grep across documents
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (e.shiftKey) {
          setSearchOpen(true);
        } else {
          setFindOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Drag-to-resize sidebar
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = e.clientX - startX;
      const newWidth = Math.max(160, Math.min(500, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  // Load doc file list
  useEffect(() => {
    let cancelled = false;
    setLoadingFiles(true);
    setSelectedDoc(null);
    setDocContent('');
    invoke<DocEntry[]>('project_list_docs', { projectPath }).then((files) => {
      if (!cancelled) {
        setDocFiles(files);
        setLoadingFiles(false);
        const readme = files.find((f) => f.name.toLowerCase() === 'readme.md');
        if (readme) {
          setSelectedDoc(readme.path);
        }
      }
    }).catch(() => {
      if (!cancelled) {
        setDocFiles([]);
        setLoadingFiles(false);
      }
    });
    return () => { cancelled = true; };
  }, [projectPath]);

  // Load selected doc content
  const loadDoc = useCallback(async (filePath: string) => {
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

  useEffect(() => {
    if (selectedDoc) {
      loadDoc(selectedDoc);
    } else {
      setDocContent('');
    }
  }, [selectedDoc, loadDoc]);

  // Scroll to target line after content loads
  useEffect(() => {
    if (targetLine && !loading && docContent && contentRef.current) {
      const timer = setTimeout(() => {
        const el = contentRef.current?.querySelector(`[id="doc-line-${targetLine}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [targetLine, loading, docContent]);

  const handleSearchSelect = useCallback((filePath: string, lineNumber: number) => {
    setTargetLine(lineNumber);
    setSelectedDoc(filePath);
  }, []);

  const handleSelectDoc = useCallback((path: string) => {
    setTargetLine(null);
    setSelectedDoc(path);
  }, []);

  const selectedFileName = selectedDoc
    ? docFiles.find((f) => f.path === selectedDoc)?.relative || selectedDoc.split('/').pop()
    : null;

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0">
        <button
          onClick={onClose}
          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title="Back to projects"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <FolderOpen className="w-5 h-5 text-amber-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm truncate">{projectName}</h3>
            {agentCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 shrink-0">
                <Bot className="w-3 h-3" />
                {agentCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <p className="text-[10px] text-muted-foreground truncate font-mono">{projectPath}</p>
            <CopyButton value={projectPath} title="Copy path" />
          </div>
        </div>
        {selectedDoc && <CopyDocButton value={docContent} />}
        <button
          onClick={() => setSearchOpen(true)}
          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title="Search across documents (Ctrl+Shift+F)"
        >
          <Search className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <div className="border-b border-border px-4 shrink-0">
          <TabsList className="h-auto bg-transparent p-0 gap-0">
            <TabsTrigger
              value="docs"
              className="px-3 py-1.5 text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground text-muted-foreground hover:text-foreground transition-colors data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Documentation
            </TabsTrigger>
            <TabsTrigger
              value="modifications"
              className="px-3 py-1.5 text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground text-muted-foreground hover:text-foreground transition-colors data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <GitBranch className="w-3 h-3 mr-1.5" />
              Modifications
              {changedFiles.length > 0 && (
                <span className="ml-1.5 text-[9px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full tabular-nums">
                  {changedFiles.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Documentation tab */}
        <TabsContent value="docs" className="flex flex-1 min-h-0 mt-0" forceMount style={{ display: activeTab === 'docs' ? undefined : 'none' }}>
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* File tree sidebar */}
            <div
              className="border-r border-border shrink-0 flex flex-col overflow-hidden"
              style={{ width: sidebarWidth }}
            >
              <div className="px-3 py-2 border-b border-border shrink-0">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Documentation</p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {loadingFiles ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <DocFileTree
                    files={docFiles}
                    selectedPath={selectedDoc}
                    onSelect={handleSelectDoc}
                  />
                )}
              </div>
            </div>

            {/* Resize handle */}
            <div
              onMouseDown={handleMouseDown}
              className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
            />

            {/* Markdown content */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <DocFindBar
                open={findOpen}
                onClose={() => setFindOpen(false)}
                containerRef={contentRef}
              />
              <div className="flex-1 overflow-y-auto" ref={contentRef}>
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : selectedDoc ? (
                  <div className="p-6">
                    {selectedFileName && (
                      <p className="text-[10px] text-muted-foreground font-mono mb-4 pb-2 border-b border-border truncate">{selectedFileName}</p>
                    )}
                    <div className="prose prose-sm dark:prose-invert max-w-none
                      prose-headings:font-semibold prose-headings:tracking-tight
                      prose-h1:text-xl prose-h1:mb-4 prose-h1:mt-0
                      prose-h2:text-lg prose-h2:mb-3
                      prose-h3:text-base prose-h3:mb-2
                      prose-p:text-sm prose-p:leading-relaxed
                      prose-code:text-xs prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
                      prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:text-xs
                      prose-li:text-sm
                      prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                      prose-table:text-sm
                      prose-th:text-left prose-th:font-medium
                    ">
                      <SimpleMarkdown content={docContent} highlightLine={targetLine ?? undefined} />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <FileText className="w-10 h-10 mb-3 opacity-30" />
                    <p className="text-sm font-medium">
                      {docFiles.length > 0 ? 'Select a document' : 'No documentation found'}
                    </p>
                    {docFiles.length > 0 && (
                      <p className="text-xs mt-1 opacity-70">{docFiles.length} file{docFiles.length !== 1 ? 's' : ''} available</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Modifications tab */}
        <TabsContent value="modifications" className="flex flex-1 min-h-0 mt-0">
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Diff sidebar */}
            <div
              className="border-r border-border shrink-0 flex flex-col overflow-hidden"
              style={{ width: sidebarWidth }}
            >
              {/* Mode selector */}
              <div className="px-3 py-2 border-b border-border shrink-0 flex items-center gap-1">
                <div className="flex flex-1 bg-muted rounded overflow-hidden">
                  <button
                    onClick={() => setDiffMode('working')}
                    className={`flex-1 text-[10px] py-1 px-2 transition-colors ${
                      diffMode === 'working'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Working
                  </button>
                  <button
                    onClick={() => setDiffMode('last_commit')}
                    className={`flex-1 text-[10px] py-1 px-2 transition-colors ${
                      diffMode === 'last_commit'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Last commit
                  </button>
                </div>
                <button
                  onClick={refreshDiff}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  title="Refresh"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingDiff ? 'animate-spin' : ''}`} />
                </button>
              </div>
              {/* File tree */}
              <div className="flex-1 overflow-y-auto">
                {loadingDiff ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <DiffFileTree
                    files={changedFiles}
                    selectedPath={selectedFile}
                    onSelect={selectFile}
                  />
                )}
              </div>
              {/* Summary */}
              {changedFiles.length > 0 && (
                <div className="px-3 py-1.5 border-t border-border shrink-0">
                  <p className="text-[10px] text-muted-foreground">
                    {changedFiles.length} file{changedFiles.length !== 1 ? 's' : ''} modified
                  </p>
                </div>
              )}
            </div>

            {/* Resize handle */}
            <div
              onMouseDown={handleMouseDown}
              className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
            />

            {/* Diff viewer */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {loadingFileDiff ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : selectedFile && fileDiff ? (
                <DiffViewer diff={fileDiff} fileName={selectedFile} />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <GitBranch className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm font-medium">
                    {changedFiles.length > 0 ? 'Select a file to view diff' : 'No modifications'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Search modal */}
      <DocSearchModal
        projectPath={projectPath}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={handleSearchSelect}
      />
    </div>
  );
}

function CopyButton({ value, title }: { value: string; title: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [value]);

  return (
    <button
      onClick={handleCopy}
      className="p-0.5 text-muted-foreground hover:text-foreground rounded transition-colors shrink-0"
      title={title}
    >
      {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
    </button>
  );
}

function CopyDocButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [value]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted border border-border rounded transition-colors shrink-0"
      title="Copy document"
    >
      {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
      <span>{copied ? 'Copied' : 'Copy document'}</span>
    </button>
  );
}
