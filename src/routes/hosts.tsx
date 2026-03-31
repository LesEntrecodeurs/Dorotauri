import { useState, useCallback, useMemo } from 'react';
import { useHosts } from '@/hooks/useHosts';
import { useHostGroups } from '@/hooks/useHostGroups';
import { isTauri } from '@/hooks/useTauri';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir, join } from '@tauri-apps/api/path';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAnimatePresence } from '@/hooks/useAnimatePresence';
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
} from '@/components/ui/context-menu';
import type { SshHost, SshHostGroup } from '@/types/ssh';
import {
  Server, Plus, Search, Loader2, AlertTriangle, Terminal as TerminalIcon,
  Pencil, Trash2, X, Key, Lock, Eye, EyeOff, FolderOpen, Folder, FolderPlus,
  ChevronLeft, ArrowRight, Palette, GripVertical,
} from 'lucide-react';

// ── Color presets ───────────────────────────────────────────────────────────

const GROUP_COLORS = [
  { name: 'Indigo', hex: '#6366f1' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Sky', hex: '#0ea5e9' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Slate', hex: '#64748b' },
];

// ── Host Form Dialog ─────────────────────────────────────────────────────────

interface HostFormData {
  name: string;
  hostname: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password: string;
  keyPath: string;
  groupId: string | null;
}

const emptyForm: HostFormData = { name: '', hostname: '', port: 22, username: '', authType: 'password', password: '', keyPath: '', groupId: null };

function HostFormDialog({ host, groups, defaultGroupId, onSave, onClose, animationState }: {
  host: SshHost | null;
  groups: SshHostGroup[];
  defaultGroupId: string | null;
  onSave: (data: HostFormData) => Promise<void>;
  onClose: () => void;
  animationState: string;
}) {
  const [form, setForm] = useState<HostFormData>(
    host
      ? { name: host.name, hostname: host.hostname, port: host.port, username: host.username, authType: host.authType, password: host.password ?? '', keyPath: host.keyPath ?? '', groupId: host.groupId }
      : { ...emptyForm, groupId: defaultGroupId }
  );
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  const canSave = form.name.trim() && form.hostname.trim() && form.username.trim() &&
    (form.authType === 'password' || form.keyPath.trim());

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch { /* error handled by hook */ }
    finally { setSaving(false); }
  };

  const handleBrowseKey = async () => {
    const sshDir = await join(await homeDir(), '.ssh');
    const path = await open({
      multiple: false,
      defaultPath: sshDir,
      filters: [],
    });
    if (path && typeof path === 'string') {
      setForm(f => ({ ...f, keyPath: path }));
    }
  };

  const update = (patch: Partial<HostFormData>) => setForm(f => ({ ...f, ...patch }));

  return (
    <div data-state={animationState} className="animate-fade fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div data-state={animationState} className="animate-modal bg-card border border-border rounded-xl w-full max-w-md p-6 shadow-xl"
        onClick={e => e.stopPropagation()}>

        <h2 className="text-lg font-semibold mb-4">{host ? 'Edit Host' : 'New Host'}</h2>

        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input value={form.name} onChange={e => update({ name: e.target.value })} placeholder="My Server" />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground">Hostname / IP</Label>
              <Input value={form.hostname} onChange={e => update({ hostname: e.target.value })} placeholder="192.168.1.100" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Port</Label>
              <Input type="number" value={form.port} onChange={e => update({ port: parseInt(e.target.value) || 22 })} />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Username</Label>
            <Input value={form.username} onChange={e => update({ username: e.target.value })} placeholder="root" />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Authentication</Label>
            <div className="flex gap-1">
              <button onClick={() => update({ authType: 'password' })}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${form.authType === 'password' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
                <Lock className="w-3.5 h-3.5" />Password
              </button>
              <button onClick={() => update({ authType: 'key' })}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${form.authType === 'key' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
                <Key className="w-3.5 h-3.5" />SSH Key
              </button>
            </div>
          </div>

          {form.authType === 'password' && (
            <div>
              <Label className="text-xs text-muted-foreground">Password <span className="text-muted-foreground/60">(optional — you can type it at connect)</span></Label>
              <div className="relative">
                <Input type={showPassword ? 'text' : 'password'} value={form.password}
                  onChange={e => update({ password: e.target.value })} placeholder="Leave empty to type at connect" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {form.authType === 'key' && (
            <div>
              <Label className="text-xs text-muted-foreground">Key File Path</Label>
              <div className="flex gap-2">
                <Input value={form.keyPath} onChange={e => update({ keyPath: e.target.value })}
                  placeholder="~/.ssh/id_rsa" className="flex-1" />
                <Button variant="outline" size="sm" onClick={handleBrowseKey}>
                  <FolderOpen className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {groups.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground">Group</Label>
              <select
                value={form.groupId ?? ''}
                onChange={e => update({ groupId: e.target.value || null })}
                className="w-full h-9 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">No group</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!canSave || saving} onClick={handleSave}>
            {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            {host ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Group Form Dialog ───────────────────────────────────────────────────────

function GroupFormDialog({ group, onSave, onClose, animationState }: {
  group: SshHostGroup | null;
  onSave: (name: string, color: string) => Promise<void>;
  onClose: () => void;
  animationState: string;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [color, setColor] = useState(group?.color ?? GROUP_COLORS[0].hex);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(name.trim(), color);
      onClose();
    } catch { /* handled */ }
    finally { setSaving(false); }
  };

  return (
    <div data-state={animationState} className="animate-fade fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div data-state={animationState} className="animate-modal bg-card border border-border rounded-xl w-full max-w-sm p-6 shadow-xl"
        onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">{group ? 'Edit Group' : 'New Group'}</h2>

        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Production" autoFocus />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Color</Label>
            <div className="flex gap-2 flex-wrap">
              {GROUP_COLORS.map(c => (
                <button key={c.hex} onClick={() => setColor(c.hex)} title={c.name}
                  className={`w-7 h-7 rounded-full transition-all ${color === c.hex ? 'ring-2 ring-offset-2 ring-offset-card ring-foreground scale-110' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c.hex }} />
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!name.trim() || saving} onClick={handleSave}>
            {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            {group ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Confirm Dialog ────────────────────────────────────────────────────

function DeleteConfirmDialog({ title, message, onConfirm, onClose, animationState }: {
  title: string; message: string; onConfirm: () => void; onClose: () => void; animationState: string;
}) {
  return (
    <div data-state={animationState} className="animate-fade fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div data-state={animationState} className="animate-modal bg-card border border-border rounded-xl w-full max-w-sm p-6 shadow-xl"
        onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-2">{title}</h2>
        <p className="text-sm text-muted-foreground mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>Delete</Button>
        </div>
      </div>
    </div>
  );
}

// ── Compact Host Card (Terminus-style) ──────────────────────────────────────

function CompactHostCard({ host, groups, onConnect, onEdit, onDelete, onMoveToGroup, isDragOverlay }: {
  host: SshHost;
  groups: SshHostGroup[];
  onConnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMoveToGroup: (groupId: string | null) => void;
  isDragOverlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `host-${host.id}`,
    data: { type: 'host', host },
  });

  const cardContent = (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      onClick={isDragging ? undefined : onConnect}
      className={`animate-mount-fade-up group cursor-pointer rounded-lg border border-border bg-card p-4 hover:bg-muted/50 transition-colors relative ${isDragging ? 'opacity-30' : ''} ${isDragOverlay ? 'shadow-xl ring-2 ring-primary/30 rotate-2' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div
          {...(isDragOverlay ? {} : { ...listeners, ...attributes })}
          className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing touch-none"
          onClick={e => e.stopPropagation()}
        >
          <Server className="w-4.5 h-4.5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{host.name}</span>
            <span className="shrink-0">
              {host.authType === 'key'
                ? <Key className="w-3 h-3 text-muted-foreground/60" />
                : <Lock className="w-3 h-3 text-muted-foreground/60" />}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {host.username}@{host.hostname}{host.port !== 22 && `:${host.port}`}
          </div>
        </div>
      </div>
    </div>
  );

  if (isDragOverlay) return cardContent;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {cardContent}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onConnect}>
          <TerminalIcon className="w-4 h-4" />Connect
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onEdit}>
          <Pencil className="w-4 h-4" />Edit
        </ContextMenuItem>
        <ContextMenuItem onClick={onDelete} className="text-red-500 focus:text-red-500">
          <Trash2 className="w-4 h-4" />Delete
        </ContextMenuItem>
        {groups.length > 0 && (
          <>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Folder className="w-4 h-4" />Move to...
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onClick={() => onMoveToGroup(null)}>
                  <X className="w-4 h-4" />No group
                </ContextMenuItem>
                <ContextMenuSeparator />
                {groups.map(g => (
                  <ContextMenuItem key={g.id} onClick={() => onMoveToGroup(g.id)}>
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                    {g.name}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── Group Card (Folder) ─────────────────────────────────────────────────────

function GroupCard({ group, onNavigate, onEdit, onDelete }: {
  group: SshHostGroup;
  onNavigate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `group-${group.id}`,
    data: { type: 'group', groupId: group.id },
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          onClick={onNavigate}
          className={`animate-mount-fade-up group cursor-pointer rounded-lg border bg-card p-4 hover:bg-muted/50 transition-all ${isOver ? 'border-primary ring-2 ring-primary/20 scale-[1.02] bg-primary/5' : 'border-border'}`}
          style={{ borderLeftWidth: 3, borderLeftColor: isOver ? undefined : group.color }}
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: group.color + '20' }}>
              <Folder className="w-4.5 h-4.5" style={{ color: group.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium truncate block">{group.name}</span>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-xs text-muted-foreground">
                  {isOver ? 'Drop here' : `${group.hostCount} host${group.hostCount !== 1 ? 's' : ''}`}
                </span>
                <ArrowRight className="w-3 h-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
              </div>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onEdit}>
          <Pencil className="w-4 h-4" />Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={onEdit}>
          <Palette className="w-4 h-4" />Change color
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onDelete} className="text-red-500 focus:text-red-500">
          <Trash2 className="w-4 h-4" />Delete group
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── Import parsers (SSH Config + Termius CSV) ────────────────────────────────

interface ParsedHost {
  name: string; hostname: string; port: number; username: string;
  authType: 'password' | 'key'; password: string; keyPath: string;
  group?: string;
}

function parseImportFile(text: string): ParsedHost[] {
  const firstLine = text.split('\n')[0]?.trim() || '';
  if (firstLine.toLowerCase().startsWith('host ') || /^#/.test(firstLine) || /^\s*Host\s/im.test(text)) {
    return parseSshConfig(text);
  }
  return parseTermiusCsv(text);
}

function parseSshConfig(text: string): ParsedHost[] {
  const results: ParsedHost[] = [];
  let current: Partial<ParsedHost> & { alias?: string } = {};

  const flush = () => {
    if (current.alias && current.hostname) {
      results.push({
        name: current.alias,
        hostname: current.hostname,
        port: current.port ?? 22,
        username: current.username ?? '',
        authType: current.keyPath ? 'key' : 'password',
        password: '',
        keyPath: current.keyPath ?? '',
      });
    }
    current = {};
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(\S+)\s+(.+)$/);
    if (!match) continue;
    const [, key, value] = match;
    const k = key.toLowerCase();

    if (k === 'host') {
      flush();
      if (value.includes('*')) continue;
      current.alias = value.trim();
    } else if (k === 'hostname') {
      current.hostname = value.trim();
    } else if (k === 'user') {
      current.username = value.trim();
    } else if (k === 'port') {
      current.port = parseInt(value.trim()) || 22;
    } else if (k === 'identityfile') {
      current.keyPath = value.trim().replace(/^~/, '');
    }
  }
  flush();

  for (const h of results) {
    if (h.keyPath && !h.keyPath.startsWith('/')) {
      h.keyPath = `~${h.keyPath}`;
    }
  }

  return results;
}

function parseTermiusCsv(csvText: string): ParsedHost[] {
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim());
  const idx = {
    label: header.findIndex(h => h === 'label' || h === 'name' || h === 'alias'),
    hostname: header.findIndex(h => h.includes('hostname') || h.includes('host') || h === 'ip' || h.includes('address')),
    port: header.findIndex(h => h === 'port'),
    username: header.findIndex(h => h === 'username' || h === 'user'),
    password: header.findIndex(h => h === 'password'),
    sshKey: header.findIndex(h => h.includes('ssh_key') || h.includes('key') || h.includes('identity')),
    group: header.findIndex(h => h.includes('group') || h.includes('folder')),
  };

  if (idx.hostname === -1) return [];
  const results: ParsedHost[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const hostname = cols[idx.hostname]?.trim() || '';
    if (!hostname) continue;

    const label = idx.label >= 0 ? cols[idx.label]?.trim() : '';
    const group = idx.group >= 0 ? cols[idx.group]?.trim() : '';
    const username = idx.username >= 0 ? cols[idx.username]?.trim() || '' : '';
    const password = idx.password >= 0 ? cols[idx.password]?.trim() || '' : '';
    const keyPath = idx.sshKey >= 0 ? cols[idx.sshKey]?.trim() || '' : '';
    const port = idx.port >= 0 ? parseInt(cols[idx.port]?.trim()) || 22 : 22;

    results.push({
      name: label || (group ? `${group}/${hostname}` : hostname),
      hostname, port, username, password, keyPath,
      authType: keyPath ? 'key' : 'password',
      group: group || undefined,
    });
  }

  return results;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else { current += ch; }
  }
  result.push(current);
  return result;
}

function ImportResultDialog({ imported, skipped, onClose, animationState }: { imported: number; skipped: number; onClose: () => void; animationState: string }) {
  return (
    <div data-state={animationState} className="animate-fade fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div data-state={animationState} className="animate-modal bg-card border border-border rounded-xl w-full max-w-sm p-6 shadow-xl"
        onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-2">Import Complete</h2>
        <div className="space-y-1 text-sm text-muted-foreground mb-4">
          <p><span className="text-green-500 font-medium">{imported}</span> host{imported !== 1 ? 's' : ''} imported</p>
          {skipped > 0 && <p><span className="text-yellow-500 font-medium">{skipped}</span> skipped (no hostname or duplicate)</p>}
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>OK</Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function HostsPage() {
  const { hosts, loading, error, createHost, updateHost, deleteHost, connectHost, refresh: refreshHosts } = useHosts();
  const { groups, loading: groupsLoading, createGroup, updateGroup, deleteGroup, moveHostToGroup, refresh: refreshGroups } = useHostGroups();

  const [search, setSearch] = useState('');
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [formDialog, setFormDialog] = useState<SshHost | 'new' | null>(null);
  const [groupFormDialog, setGroupFormDialog] = useState<SshHostGroup | 'new' | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ type: 'host'; host: SshHost } | { type: 'group'; group: SshHostGroup } | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [draggedHost, setDraggedHost] = useState<SshHost | null>(null);

  const formDialogAnim = useAnimatePresence(formDialog !== null);
  const groupFormDialogAnim = useAnimatePresence(groupFormDialog !== null);
  const deleteDialogAnim = useAnimatePresence(deleteDialog !== null);
  const importResultAnim = useAnimatePresence(importResult !== null);

  const currentGroup = useMemo(() => groups.find(g => g.id === currentGroupId) ?? null, [groups, currentGroupId]);

  // If current group was deleted, go back to root
  if (currentGroupId && !currentGroup && !groupsLoading) {
    setCurrentGroupId(null);
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return hosts.filter(h =>
      h.name.toLowerCase().includes(q) || h.hostname.toLowerCase().includes(q) || h.username.toLowerCase().includes(q)
    );
  }, [hosts, search]);

  // In root: show ungrouped hosts. In group: show that group's hosts.
  const visibleHosts = useMemo(() =>
    filtered.filter(h => currentGroupId ? h.groupId === currentGroupId : !h.groupId),
    [filtered, currentGroupId]
  );

  // In root view with search: also show groups that contain matching hosts
  const visibleGroups = useMemo(() => {
    if (currentGroupId) return [];
    if (!search) return groups;
    const groupIdsWithMatch = new Set(filtered.filter(h => h.groupId).map(h => h.groupId!));
    return groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase()) || groupIdsWithMatch.has(g.id));
  }, [groups, currentGroupId, search, filtered]);

  const handleConnect = useCallback(async (host: SshHost) => {
    const ptyId = `ssh-${host.id}-${Date.now()}`;
    const password = await connectHost(host.id, ptyId);
    const label = `${host.name} — ${host.username}@${host.hostname}`;
    await invoke('ssh_open_window', { ptyId, label, password: password || null });
  }, [connectHost]);

  const handleSaveHost = useCallback(async (data: HostFormData) => {
    if (formDialog === 'new') {
      await createHost(data);
    } else if (formDialog) {
      await updateHost(formDialog.id, data);
    }
    await refreshGroups();
  }, [formDialog, createHost, updateHost, refreshGroups]);

  const handleSaveGroup = useCallback(async (name: string, color: string) => {
    if (groupFormDialog === 'new') {
      await createGroup(name, color);
    } else if (groupFormDialog) {
      await updateGroup(groupFormDialog.id, name, color);
    }
  }, [groupFormDialog, createGroup, updateGroup]);

  const handleDelete = useCallback(async () => {
    if (!deleteDialog) return;
    if (deleteDialog.type === 'host') {
      await deleteHost(deleteDialog.host.id);
      await refreshGroups();
    } else {
      await deleteGroup(deleteDialog.group.id);
      await refreshHosts();
    }
    setDeleteDialog(null);
  }, [deleteDialog, deleteHost, deleteGroup, refreshGroups, refreshHosts]);

  const handleMoveToGroup = useCallback(async (hostId: string, groupId: string | null) => {
    await moveHostToGroup(hostId, groupId);
    await refreshHosts();
  }, [moveHostToGroup, refreshHosts]);

  // ── Drag & Drop ──
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const sensors = useSensors(pointerSensor);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const host = event.active.data.current?.host as SshHost | undefined;
    if (host) setDraggedHost(host);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setDraggedHost(null);
    const { active, over } = event;
    if (!over) return;
    const host = active.data.current?.host as SshHost | undefined;
    const groupId = over.data.current?.groupId as string | undefined;
    if (host && groupId && host.groupId !== groupId) {
      await handleMoveToGroup(host.id, groupId);
    }
  }, [handleMoveToGroup]);

  const handleScanHosts = useCallback(async () => {
    setImporting(true);
    try {
      const home = await homeDir();
      const configPath = await join(home, '.ssh', 'config');
      const configText = await invoke<string>('ssh_read_file', { path: configPath });
      const parsed = parseSshConfig(configText);

      const existingKeys = new Set(hosts.map(h => `${h.username}@${h.hostname}:${h.port}`));
      let imported = 0;
      let skipped = 0;

      for (const entry of parsed) {
        if (!entry.hostname) { skipped++; continue; }
        const key = `${entry.username}@${entry.hostname}:${entry.port}`;
        if (existingKeys.has(key)) { skipped++; continue; }
        existingKeys.add(key);
        try { await createHost({ ...entry, groupId: currentGroupId }); imported++; } catch { skipped++; }
      }

      setImportResult({ imported, skipped });
    } catch {
      setImportResult({ imported: 0, skipped: 0 });
    } finally {
      setImporting(false);
    }
  }, [hosts, createHost, currentGroupId]);

  const handleImportFile = useCallback(async () => {
    const filePath = await open({
      multiple: false,
      filters: [{ name: 'SSH Config & CSV', extensions: ['csv', 'conf', 'config', 'txt', ''] }],
    });
    if (!filePath || typeof filePath !== 'string') return;

    setImporting(true);
    try {
      const fileText = await invoke<string>('ssh_read_file', { path: filePath });
      const parsed = parseImportFile(fileText);

      // Auto-create groups from CSV group column
      const groupMap = new Map<string, string>(); // group name -> group id
      for (const g of groups) groupMap.set(g.name.toLowerCase(), g.id);

      for (const entry of parsed) {
        if (entry.group && !groupMap.has(entry.group.toLowerCase())) {
          await createGroup(entry.group);
          await refreshGroups();
          // Re-fetch to get the new group id
          const updatedGroups = await invoke<{ groups: SshHostGroup[] }>('ssh_list_host_groups');
          for (const g of updatedGroups.groups) groupMap.set(g.name.toLowerCase(), g.id);
        }
      }

      const existingKeys = new Set(hosts.map(h => `${h.username}@${h.hostname}:${h.port}`));
      let imported = 0;
      let skipped = 0;

      for (const entry of parsed) {
        if (!entry.hostname) { skipped++; continue; }
        const key = `${entry.username}@${entry.hostname}:${entry.port}`;
        if (existingKeys.has(key)) { skipped++; continue; }
        existingKeys.add(key);
        const groupId = entry.group ? groupMap.get(entry.group.toLowerCase()) ?? null : currentGroupId;
        try { await createHost({ ...entry, groupId }); imported++; } catch { skipped++; }
      }

      setImportResult({ imported, skipped });
      await refreshGroups();
    } catch (err) {
      console.error('Import failed:', err);
    } finally {
      setImporting(false);
    }
  }, [hosts, groups, createHost, createGroup, refreshGroups, currentGroupId]);

  if (!isTauri()) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-center">
        <div>
          <Server className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">SSH Hosts is only available in the desktop app.</p>
        </div>
      </div>
    );
  }

  const isRoot = !currentGroupId;
  const totalCount = hosts.length;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <div className="h-[calc(100vh-7rem)] lg:h-[calc(100vh-3rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {!isRoot && (
            <button onClick={() => setCurrentGroupId(null)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0">
              <ChevronLeft className="w-4 h-4" />
              Hosts
            </button>
          )}
          <div className="min-w-0">
            {isRoot ? (
              <>
                <h1 className="text-2xl font-bold">Hosts</h1>
                <p className="text-sm text-muted-foreground">{totalCount} saved connection{totalCount !== 1 ? 's' : ''}</p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: currentGroup?.color }} />
                  <h1 className="text-2xl font-bold truncate">{currentGroup?.name}</h1>
                </div>
                <p className="text-sm text-muted-foreground">{visibleHosts.length} host{visibleHosts.length !== 1 ? 's' : ''}</p>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isRoot && (
            <>
              <Button variant="outline" size="sm" onClick={() => setGroupFormDialog('new')}>
                <FolderPlus className="w-4 h-4 mr-1.5" />Group
              </Button>
              <Button variant="outline" size="sm" onClick={handleScanHosts} disabled={importing} title="Import from ~/.ssh/config">
                {importing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Search className="w-4 h-4 mr-1.5" />}
                Scan
              </Button>
              <Button variant="outline" size="sm" onClick={handleImportFile} disabled={importing} title="Import from CSV or config file">
                <FolderOpen className="w-4 h-4 mr-1.5" />Import
              </Button>
            </>
          )}
          <Button size="sm" onClick={() => setFormDialog('new')}>
            <Plus className="w-4 h-4 mr-1.5" />Host
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-destructive/10 text-destructive text-sm shrink-0">
          <AlertTriangle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4 shrink-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="text" placeholder="Filter by name, hostname, or username..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
      </div>

      {/* Content grid */}
      <div className="flex-1 overflow-auto min-h-0">
        {(loading || groupsLoading) ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (visibleGroups.length === 0 && visibleHosts.length === 0) ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            {isRoot ? (
              <>
                <Server className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">{search ? 'No hosts match your search.' : 'No hosts yet. Add one to get started.'}</p>
              </>
            ) : (
              <>
                <Folder className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">{search ? 'No hosts match your search in this group.' : 'This group is empty. Add a host to get started.'}</p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 pb-4">
            {/* Group cards (root only) */}
            {visibleGroups.map(g => (
              <GroupCard
                key={g.id}
                group={g}
                onNavigate={() => { setCurrentGroupId(g.id); setSearch(''); }}
                onEdit={() => setGroupFormDialog(g)}
                onDelete={() => setDeleteDialog({ type: 'group', group: g })}
              />
            ))}
            {/* Host cards */}
            {visibleHosts.map(h => (
              <CompactHostCard
                key={h.id}
                host={h}
                groups={groups}
                onConnect={() => handleConnect(h)}
                onEdit={() => setFormDialog(h)}
                onDelete={() => setDeleteDialog({ type: 'host', host: h })}
                onMoveToGroup={(gid) => handleMoveToGroup(h.id, gid)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      {formDialogAnim.shouldRender && formDialog && (
        <HostFormDialog
          key={formDialog === 'new' ? 'new' : formDialog.id}
          host={formDialog === 'new' ? null : formDialog}
          groups={groups}
          defaultGroupId={currentGroupId}
          onSave={handleSaveHost}
          onClose={() => setFormDialog(null)}
          animationState={formDialogAnim.animationState} />
      )}
      {groupFormDialogAnim.shouldRender && groupFormDialog && (
        <GroupFormDialog
          key={groupFormDialog === 'new' ? 'new' : groupFormDialog.id}
          group={groupFormDialog === 'new' ? null : groupFormDialog}
          onSave={handleSaveGroup}
          onClose={() => setGroupFormDialog(null)}
          animationState={groupFormDialogAnim.animationState} />
      )}
      {deleteDialogAnim.shouldRender && deleteDialog && (
        <DeleteConfirmDialog
          title={deleteDialog.type === 'host' ? 'Delete Host' : 'Delete Group'}
          message={
            deleteDialog.type === 'host'
              ? `Remove ${deleteDialog.host.name} (${deleteDialog.host.username}@${deleteDialog.host.hostname})? This cannot be undone.`
              : `Delete group "${deleteDialog.group.name}"? Hosts in this group will become ungrouped.`
          }
          onConfirm={handleDelete}
          onClose={() => setDeleteDialog(null)}
          animationState={deleteDialogAnim.animationState} />
      )}
      {importResultAnim.shouldRender && importResult && (
        <ImportResultDialog
          imported={importResult.imported}
          skipped={importResult.skipped}
          onClose={() => setImportResult(null)}
          animationState={importResultAnim.animationState} />
      )}
    </div>
    <DragOverlay dropAnimation={null}>
      {draggedHost && (
        <div className="w-[220px]">
          <CompactHostCard
            host={draggedHost}
            groups={[]}
            onConnect={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            onMoveToGroup={() => {}}
            isDragOverlay
          />
        </div>
      )}
    </DragOverlay>
    </DndContext>
  );
}
