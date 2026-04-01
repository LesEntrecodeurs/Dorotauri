import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface GitChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
}

export interface DiffHunkLine {
  lineType: 'add' | 'remove' | 'context';
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffHunkLine[];
}

export interface FileDiff {
  path: string;
  status: string;
  isBinary: boolean;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export type DiffMode = 'working' | 'last_commit';

export function useDiffData(projectPath: string, active: boolean) {
  const [changedFiles, setChangedFiles] = useState<GitChangedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<FileDiff | null>(null);
  const [diffMode, setDiffMode] = useState<DiffMode>('working');
  const [loading, setLoading] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const fetchFiles = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const files = await invoke<GitChangedFile[]>('project_git_changed_files', {
        projectPath,
        mode: diffMode,
      });
      setChangedFiles(files);
      setSelectedFile((prev) => {
        if (prev && !files.some((f) => f.path === prev)) return null;
        return prev;
      });
    } catch {
      setChangedFiles([]);
    } finally {
      setLoading(false);
    }
  }, [projectPath, diffMode, active]);

  useEffect(() => {
    if (active) {
      fetchFiles();
    }
  }, [fetchFiles, active]);

  useEffect(() => {
    if (!selectedFile || !active) {
      setFileDiff(null);
      return;
    }
    let cancelled = false;
    setLoadingDiff(true);
    invoke<FileDiff>('project_git_diff_file', {
      projectPath,
      filePath: selectedFile,
      mode: diffMode,
    })
      .then((diff) => {
        if (!cancelled) setFileDiff(diff);
      })
      .catch(() => {
        if (!cancelled) setFileDiff(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingDiff(false);
      });
    return () => { cancelled = true; };
  }, [selectedFile, projectPath, diffMode, active]);

  const selectFile = useCallback((path: string) => {
    setSelectedFile(path);
  }, []);

  const refresh = useCallback(() => {
    fetchFiles();
  }, [fetchFiles]);

  return {
    changedFiles,
    selectedFile,
    fileDiff,
    diffMode,
    setDiffMode,
    selectFile,
    refresh,
    loading,
    loadingDiff,
  };
}
