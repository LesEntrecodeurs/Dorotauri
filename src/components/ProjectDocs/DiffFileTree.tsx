import { useState, useMemo } from 'react';
import {
  ChevronRight,
  ChevronDown,
  FolderOpen,
  FilePlus,
  FileText,
  FileMinus,
  FileSymlink,
} from 'lucide-react';
import type { GitChangedFile } from './useDiffData';

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  status?: string;
  children: TreeNode[];
}

interface DiffFileTreeProps {
  files: GitChangedFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

const STATUS_CONFIG: Record<string, { color: string; badge: string; Icon: typeof FileText }> = {
  added:    { color: 'text-green-500', badge: 'A', Icon: FilePlus },
  modified: { color: 'text-amber-500', badge: 'M', Icon: FileText },
  deleted:  { color: 'text-red-500',   badge: 'D', Icon: FileMinus },
  renamed:  { color: 'text-blue-500',  badge: 'R', Icon: FileSymlink },
};

function buildTree(files: GitChangedFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  for (const file of files) {
    const parts = file.path.split('/');
    if (parts.length === 1) {
      root.push({ name: parts[0], path: file.path, isDir: false, status: file.status, children: [] });
    } else {
      let currentChildren = root;
      let currentPath = '';
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
        let dirNode = dirMap.get(currentPath);
        if (!dirNode) {
          dirNode = { name: parts[i], path: currentPath, isDir: true, children: [] };
          dirMap.set(currentPath, dirNode);
          currentChildren.push(dirNode);
        }
        currentChildren = dirNode.children;
      }
      currentChildren.push({
        name: parts[parts.length - 1],
        path: file.path,
        isDir: false,
        status: file.status,
        children: [],
      });
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
  const config = node.status ? STATUS_CONFIG[node.status] : null;

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
          <FolderOpen className="w-3.5 h-3.5 shrink-0 text-amber-500" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children.map((child) => (
          <TreeItem key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  const Icon = config?.Icon ?? FileText;

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex items-center gap-1.5 w-full px-2 py-1 text-xs transition-colors ${
        isSelected
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      }`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      title={node.path}
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${config?.color ?? ''}`} />
      <span className={`truncate flex-1 text-left ${node.status === 'deleted' ? 'line-through' : ''}`}>
        {node.name}
      </span>
      {config && (
        <span className={`text-[9px] font-bold ${config.color} shrink-0`}>{config.badge}</span>
      )}
    </button>
  );
}

export function DiffFileTree({ files, selectedPath, onSelect }: DiffFileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);

  if (files.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground text-center">
        No modifications
      </div>
    );
  }

  return (
    <div className="py-1">
      {tree.map((node) => (
        <TreeItem key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </div>
  );
}
