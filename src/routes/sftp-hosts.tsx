import { useState, useCallback } from 'react';
import { useSftpHosts } from '@/hooks/useSftpHosts';
import { isTauri } from '@/hooks/useTauri';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir, join } from '@tauri-apps/api/path';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from 'framer-motion';
import type { SftpHost } from '@/types/sftp-host';
import {
  FolderSync, Plus, Search, Loader2, AlertTriangle,
  Pencil, Trash2, X, Key, Lock, Eye, EyeOff, FolderOpen,
} from 'lucide-react';

// ── Host Form Dialog ─────────────────────────────────────────────────────────

interface HostFormData {
  name: string;
  hostname: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password: string;
  keyPath: string;
}

const emptyForm: HostFormData = { name: '', hostname: '', port: 22, username: '', authType: 'password', password: '', keyPath: '' };

function HostFormDialog({ host, onSave, onClose }: {
  host: SftpHost | null;
  onSave: (data: HostFormData) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<HostFormData>(
    host
      ? { name: host.name, hostname: host.hostname, port: host.port, username: host.username, authType: host.authType, password: host.password ?? '', keyPath: host.keyPath ?? '' }
      : emptyForm
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        className="bg-card border border-border rounded-xl w-full max-w-md p-6 shadow-xl"
        onClick={e => e.stopPropagation()}>

        <h2 className="text-lg font-semibold mb-4">{host ? 'Edit SFTP Host' : 'New SFTP Host'}</h2>

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
              <Label className="text-xs text-muted-foreground">Password</Label>
              <div className="relative">
                <Input type={showPassword ? 'text' : 'password'} value={form.password}
                  onChange={e => update({ password: e.target.value })} placeholder="Enter password" />
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
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!canSave || saving} onClick={handleSave}>
            {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            {host ? 'Save' : 'Create'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Delete Confirm Dialog ────────────────────────────────────────────────────

function DeleteConfirmDialog({ host, onConfirm, onClose }: {
  host: SftpHost; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        className="bg-card border border-border rounded-xl w-full max-w-sm p-6 shadow-xl"
        onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-2">Delete SFTP Host</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Remove <strong>{host.name}</strong> ({host.username}@{host.hostname})? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>Delete</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Host Card ────────────────────────────────────────────────────────────────

function SftpHostCard({ host, onConnect, onEdit, onDelete }: {
  host: SftpHost; onConnect: () => void; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors">
      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <FolderSync className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{host.name}</span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 border-0">
            {host.authType === 'key' ? <><Key className="w-2.5 h-2.5 mr-0.5" />Key</> : <><Lock className="w-2.5 h-2.5 mr-0.5" />Pass</>}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 truncate">
          {host.username}@{host.hostname}{host.port !== 22 && `:${host.port}`}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <Button variant="default" size="sm" className="h-8 px-3" onClick={onConnect}>
          <FolderSync className="w-3.5 h-3.5 mr-1.5" />Connect
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={onEdit} title="Edit">
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={onDelete} title="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </motion.div>
  );
}

// ── Import parsers (SSH Config + Termius CSV) ────────────────────────────────

interface ParsedHost {
  name: string; hostname: string; port: number; username: string;
  authType: 'password' | 'key'; password: string; keyPath: string;
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

function ImportResultDialog({ imported, skipped, onClose }: { imported: number; skipped: number; onClose: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        className="bg-card border border-border rounded-xl w-full max-w-sm p-6 shadow-xl"
        onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-2">Import Complete</h2>
        <div className="space-y-1 text-sm text-muted-foreground mb-4">
          <p><span className="text-green-500 font-medium">{imported}</span> host{imported !== 1 ? 's' : ''} imported</p>
          {skipped > 0 && <p><span className="text-yellow-500 font-medium">{skipped}</span> skipped (no hostname or duplicate)</p>}
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>OK</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SftpHostsPage() {
  const { hosts, loading, error, createHost, updateHost, deleteHost, openSftp } = useSftpHosts();

  const [search, setSearch] = useState('');
  const [formDialog, setFormDialog] = useState<SftpHost | 'new' | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<SftpHost | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [importing, setImporting] = useState(false);

  const filtered = hosts.filter(h => {
    const q = search.toLowerCase();
    return h.name.toLowerCase().includes(q) || h.hostname.toLowerCase().includes(q) || h.username.toLowerCase().includes(q);
  });

  const handleConnect = useCallback(async (host: SftpHost) => {
    await openSftp(host);
  }, [openSftp]);

  const handleSave = useCallback(async (data: HostFormData) => {
    if (formDialog === 'new') {
      await createHost(data);
    } else if (formDialog) {
      await updateHost(formDialog.id, data);
    }
  }, [formDialog, createHost, updateHost]);

  const handleDelete = useCallback(async () => {
    if (!deleteDialog) return;
    await deleteHost(deleteDialog.id);
    setDeleteDialog(null);
  }, [deleteDialog, deleteHost]);

  const handleScanHosts = useCallback(async () => {
    setImporting(true);
    try {
      const home = await homeDir();
      const configPath = await join(home, '.ssh', 'config');
      const configText = await invoke<string>('sftp_read_file', { path: configPath });
      const parsed = parseSshConfig(configText);

      const existingKeys = new Set(hosts.map(h => `${h.username}@${h.hostname}:${h.port}`));
      let imported = 0;
      let skipped = 0;

      for (const entry of parsed) {
        if (!entry.hostname) { skipped++; continue; }
        const key = `${entry.username}@${entry.hostname}:${entry.port}`;
        if (existingKeys.has(key)) { skipped++; continue; }
        existingKeys.add(key);
        try { await createHost(entry); imported++; } catch { skipped++; }
      }

      setImportResult({ imported, skipped });
    } catch {
      setImportResult({ imported: 0, skipped: 0 });
    } finally {
      setImporting(false);
    }
  }, [hosts, createHost]);

  const handleImportFile = useCallback(async () => {
    const filePath = await open({
      multiple: false,
      filters: [{ name: 'SSH Config & CSV', extensions: ['csv', 'conf', 'config', 'txt', ''] }],
    });
    if (!filePath || typeof filePath !== 'string') return;

    setImporting(true);
    try {
      const fileText = await invoke<string>('sftp_read_file', { path: filePath });
      const parsed = parseImportFile(fileText);

      const existingKeys = new Set(hosts.map(h => `${h.username}@${h.hostname}:${h.port}`));
      let imported = 0;
      let skipped = 0;

      for (const entry of parsed) {
        if (!entry.hostname) { skipped++; continue; }
        const key = `${entry.username}@${entry.hostname}:${entry.port}`;
        if (existingKeys.has(key)) { skipped++; continue; }
        existingKeys.add(key);
        try { await createHost(entry); imported++; } catch { skipped++; }
      }

      setImportResult({ imported, skipped });
    } catch (err) {
      console.error('Import failed:', err);
    } finally {
      setImporting(false);
    }
  }, [hosts, createHost]);

  if (!isTauri()) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-center">
        <div>
          <FolderSync className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">SFTP is only available in the desktop app.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-7rem)] lg:h-[calc(100vh-3rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold">SFTP</h1>
          <p className="text-sm text-muted-foreground">{hosts.length} saved connection{hosts.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleScanHosts} disabled={importing} title="Import from ~/.ssh/config">
            {importing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Search className="w-4 h-4 mr-1.5" />}
            Scan SSH Config
          </Button>
          <Button variant="outline" size="sm" onClick={handleImportFile} disabled={importing} title="Import from CSV or config file">
            <FolderOpen className="w-4 h-4 mr-1.5" />Import File
          </Button>
          <Button size="sm" onClick={() => setFormDialog('new')}>
            <Plus className="w-4 h-4 mr-1.5" />Add Host
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

      {/* Host list */}
      <div className="flex-1 overflow-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <FolderSync className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm">{search ? 'No hosts match your search.' : 'No SFTP hosts yet. Add one to get started.'}</p>
          </div>
        ) : (
          <div className="grid gap-2 pb-4">
            {filtered.map(h => (
              <SftpHostCard key={h.id} host={h}
                onConnect={() => handleConnect(h)}
                onEdit={() => setFormDialog(h)}
                onDelete={() => setDeleteDialog(h)} />
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <AnimatePresence>
        {formDialog && (
          <HostFormDialog
            key={formDialog === 'new' ? 'new' : formDialog.id}
            host={formDialog === 'new' ? null : formDialog}
            onSave={handleSave}
            onClose={() => setFormDialog(null)} />
        )}
        {deleteDialog && (
          <DeleteConfirmDialog key={deleteDialog.id}
            host={deleteDialog}
            onConfirm={handleDelete}
            onClose={() => setDeleteDialog(null)} />
        )}
        {importResult && (
          <ImportResultDialog
            imported={importResult.imported}
            skipped={importResult.skipped}
            onClose={() => setImportResult(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
