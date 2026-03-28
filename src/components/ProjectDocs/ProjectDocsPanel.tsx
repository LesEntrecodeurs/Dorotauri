import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileText, Bot, ArrowLeft, Loader2, FolderOpen } from 'lucide-react';
import { DocFileTree } from './DocFileTree';
import type { DocEntry } from './DocFileTree';
import { SimpleMarkdown } from '@/components/VaultView/components/MarkdownRenderer';

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

  const selectedFileName = selectedDoc
    ? docFiles.find((f) => f.path === selectedDoc)?.relative || selectedDoc.split('/').pop()
    : null;

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
          <p className="text-[10px] text-muted-foreground truncate mt-0.5 font-mono">{projectPath}</p>
        </div>
      </div>

      {/* Content area */}
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
                onSelect={setSelectedDoc}
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
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : selectedDoc ? (
            <div className="p-6">
              {selectedFileName && (
                <p className="text-[10px] text-muted-foreground font-mono mb-4 pb-2 border-b border-border">{selectedFileName}</p>
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
                <SimpleMarkdown content={docContent} />
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
  );
}
