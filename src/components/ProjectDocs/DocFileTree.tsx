import { FileText, ChevronRight, ChevronDown, FolderOpen } from 'lucide-react';
import { useState, useMemo } from 'react';

export interface DocEntry {
  name: string;
  path: string;
  relative: string;
  isDir: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  relative: string;
  isDir: boolean;
  children: TreeNode[];
}

interface DocFileTreeProps {
  files: DocEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function buildTree(files: DocEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  for (const file of files) {
    const parts = file.relative.split('/');
    if (parts.length === 1) {
      root.push({ ...file, children: [] });
    } else {
      let currentChildren = root;
      let currentPath = '';
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
        let dirNode = dirMap.get(currentPath);
        if (!dirNode) {
          dirNode = {
            name: parts[i],
            path: currentPath,
            relative: currentPath,
            isDir: true,
            children: [],
          };
          dirMap.set(currentPath, dirNode);
          currentChildren.push(dirNode);
        }
        currentChildren = dirNode.children;
      }
      currentChildren.push({ ...file, children: [] });
    }
  }

  return root;
}

function TreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = node.path === selectedPath;

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 shrink-0" />
          )}
          <FolderOpen className="w-3.5 h-3.5 shrink-0 text-amber-500" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex items-center gap-1.5 w-full px-2 py-1 text-xs transition-colors ${
        isSelected
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      }`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      title={node.relative}
    >
      <FileText className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function DocFileTree({ files, selectedPath, onSelect }: DocFileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);

  if (files.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground text-center">
        No documentation files found
      </div>
    );
  }

  return (
    <div className="py-1">
      {tree.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
