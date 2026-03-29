

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  FolderKanban,
  X,
  Loader2,
  FolderOpen,
  Folder,
  Plus,
  FolderPlus,
  Search,
} from 'lucide-react';
import { useClaude } from '@/hooks/useClaude';
import { useElectronAgents, useElectronFS } from '@/hooks/useElectron';
import type { ClaudeProject } from '@/lib/claude-code';
import { ProjectDocsPanel } from '@/components/ProjectDocs/ProjectDocsPanel';

// Generate consistent colors for projects based on name
const getProjectColor = (name: string) => {
  const colors = [
    { main: '#3B82F6', bg: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.3)' },   // blue
    { main: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.15)', border: 'rgba(139, 92, 246, 0.3)' },   // purple
    { main: '#22C55E', bg: 'rgba(34, 197, 94, 0.15)', border: 'rgba(34, 197, 94, 0.3)' },     // green
    { main: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.3)' },   // amber
    { main: '#EF4444', bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.3)' },     // red
    { main: '#06B6D4', bg: 'rgba(6, 182, 212, 0.15)', border: 'rgba(6, 182, 212, 0.3)' },     // cyan
    { main: '#EC4899', bg: 'rgba(236, 72, 153, 0.15)', border: 'rgba(236, 72, 153, 0.3)' },   // pink
    { main: '#F97316', bg: 'rgba(249, 115, 22, 0.15)', border: 'rgba(249, 115, 22, 0.3)' },   // orange
  ];
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
};

const CUSTOM_PROJECTS_KEY = 'dorotoring-custom-projects';

interface CustomProject {
  path: string;
  name: string;
  addedAt: string;
}


export default function ProjectsPage() {
  const { data, loading, error } = useClaude();
  const { agents, isElectron: hasElectron } = useElectronAgents();
  const { openFolderDialog } = useElectronFS();
  const [selectedProject, setSelectedProject] = useState<ClaudeProject | null>(null);
  const [customProjects, setCustomProjects] = useState<CustomProject[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  // Load custom projects from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CUSTOM_PROJECTS_KEY);
      if (stored) {
        setCustomProjects(JSON.parse(stored));
      }
    } catch (err) {
      console.error('Failed to load custom projects:', err);
    }
  }, []);

  // Save custom projects
  const saveCustomProjects = (projects: CustomProject[]) => {
    setCustomProjects(projects);
    try {
      localStorage.setItem(CUSTOM_PROJECTS_KEY, JSON.stringify(projects));
    } catch (err) {
      console.error('Failed to save custom projects:', err);
    }
  };

  // Add a new project
  const handleAddProject = async () => {
    if (!openFolderDialog) return;
    try {
      const selectedPath = await openFolderDialog();
      if (selectedPath) {
        const normalizedPath = selectedPath.replace(/\/+$/, '');
        const existsInCustom = customProjects.some(p => p.path.replace(/\/+$/, '').toLowerCase() === normalizedPath.toLowerCase());
        if (!existsInCustom) {
          const name = selectedPath.split('/').pop() || 'Unknown Project';
          saveCustomProjects([...customProjects, { path: normalizedPath, name, addedAt: new Date().toISOString() }]);
        }
      }
    } catch (err) {
      console.error('Failed to add project:', err);
    }
  };

  // Flexible path matching
  const pathsMatch = (path1: string, path2: string) => {
    const normalize = (p: string) => p.replace(/\/+$/, '').toLowerCase();
    const norm1 = normalize(path1);
    const norm2 = normalize(path2);
    if (norm1 === norm2) return true;
    if (norm1.endsWith(norm2) || norm2.endsWith(norm1)) return true;
    const name1 = norm1.split('/').pop();
    const name2 = norm2.split('/').pop();
    if (name1 && name2 && name1 === name2) {
      const parts1 = norm1.split('/').filter(Boolean);
      const parts2 = norm2.split('/').filter(Boolean);
      if (parts1.length >= 2 && parts2.length >= 2) {
        if (parts1.slice(-2).join('/') === parts2.slice(-2).join('/')) return true;
      }
    }
    return false;
  };


  // Merge Claude Code projects with custom projects
  const claudeProjects = data?.projects || [];
  const allProjects = useMemo(() => {
    const merged: ClaudeProject[] = [...claudeProjects];
    customProjects.forEach(cp => {
      const exists = claudeProjects.some(p => pathsMatch(p.path, cp.path));
      if (!exists) {
        merged.push({
          id: `custom-${cp.path}`,
          name: cp.name,
          path: cp.path,
          sessions: [],
          lastActivity: new Date(cp.addedAt),
        });
      }
    });
    return merged;
  }, [claudeProjects, customProjects]);

  // Auto-select project from query param (e.g. from agent card click)
  useEffect(() => {
    const selectPath = searchParams.get('select');
    if (selectPath && allProjects.length > 0) {
      const match = allProjects.find(p => pathsMatch(p.path, selectPath));
      if (match) {
        setSelectedProject(match);
      }
      // Clear the query param after processing
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, allProjects]);

  // Filter projects based on search query
  const projects = useMemo(() => {
    if (!searchQuery.trim()) return allProjects;
    const query = searchQuery.toLowerCase();
    return allProjects.filter(p =>
      p.name.toLowerCase().includes(query) ||
      p.path.toLowerCase().includes(query)
    );
  }, [allProjects, searchQuery]);

  const formatDate = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Get short path for display
  const getShortPath = (path: string) => {
    const parts = path.split('/');
    if (parts.length <= 3) return path;
    return '~/' + parts.slice(-2).join('/');
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-white mx-auto mb-4" />
          <p className="text-muted-foreground">Loading projects...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center text-red-400">
          <p className="mb-2">Failed to load projects</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  // Full-screen doc panel when a project is selected
  if (selectedProject) {
    return (
      <div className="h-[calc(100vh-3rem)] overflow-hidden">
        <ProjectDocsPanel
          projectPath={selectedProject.path}
          projectName={selectedProject.name}
          agentCount={agents.filter(a => pathsMatch(a.cwd, selectedProject.path)).length}
          onClose={() => setSelectedProject(null)}
        />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-3rem)] overflow-y-auto">
      <div className="space-y-4 lg:space-y-6 pt-4 lg:pt-6 px-4 lg:px-6 pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground text-xs lg:text-sm mt-1 hidden sm:block">
            {allProjects.length} project{allProjects.length !== 1 ? 's' : ''}
          </p>
        </div>
        {hasElectron && (
          <button
            onClick={handleAddProject}
            className="flex items-center gap-2 px-4 py-2 bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            <FolderPlus className="w-4 h-4" />
            Add Project
          </button>
        )}
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search projects..."
          className="w-full pl-9 pr-3 py-2 bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:border-white/50 focus:outline-none transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-white transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Projects Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {projects.map((project) => {
          const isSelected = selectedProject?.id === project.id;
          const linkedAgents = agents.filter(a => pathsMatch(a.cwd, project.path));
          const color = getProjectColor(project.name);

          return (
            <div
              key={project.id}
              onClick={() => setSelectedProject(isSelected ? null : project)}
              className="group relative cursor-pointer"
            >
              {/* Folder Card */}
              <div
                className={`
                  relative bg-card border p-4 transition-all h-full
                  ${isSelected
                    ? 'border-white shadow-lg shadow-white/10'
                    : 'border-border hover:border-white/30'
                  }
                `}
                style={{
                  borderBottomColor: isSelected ? color.main : undefined,
                  borderBottomWidth: isSelected ? '2px' : undefined,
                }}
              >
                {/* Folder Icon with Color */}
                <div className="flex items-center justify-center mb-3 pt-1">
                  <div
                    className="relative w-14 h-11 flex items-center justify-center rounded-sm"
                    style={{ backgroundColor: color.bg }}
                  >
                    {isSelected ? (
                      <FolderOpen className="w-8 h-8" style={{ color: color.main }} />
                    ) : (
                      <Folder
                        className="w-8 h-8 transition-colors"
                        style={{ color: color.main }}
                      />
                    )}
                    {/* Agent badge */}
                    {linkedAgents.length > 0 && (
                      <div
                        className="absolute -top-2 -right-8 px-1.5 py-0.5 text-[9px] font-medium flex items-center justify-center text-white whitespace-nowrap"
                        style={{ backgroundColor: color.main }}
                      >
                        {linkedAgents.length} agent{linkedAgents.length > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                </div>

                {/* Project Info */}
                <div className="text-center space-y-1">
                  <h3 className="font-normal text-sm truncate font-sans" title={project.name}>
                    {project.name}
                  </h3>
                  <p className="text-[10px] text-muted-foreground font-mono truncate" title={project.path}>
                    {getShortPath(project.path)}
                  </p>
                  <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
                    <span>{project.sessions.length} sessions</span>
                    <span>·</span>
                    <span>{formatDate(project.lastActivity)}</span>
                  </div>
                </div>

              </div>
            </div>
          );
        })}

        {/* Add Project Card */}
        {hasElectron && (
          <div
            onClick={handleAddProject}
            className="cursor-pointer"
          >
            <div className="relative bg-card border border-dashed border-border p-4 hover:border-white/30 transition-all h-full min-h-[140px] flex flex-col items-center justify-center gap-2">
              <div className="w-14 h-11 flex items-center justify-center rounded-sm bg-white/5">
                <Plus className="w-6 h-6 text-muted-foreground" />
              </div>
              <span className="text-xs text-muted-foreground">Add Project</span>
            </div>
          </div>
        )}
      </div>

      {/* Empty State */}
      {projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <FolderKanban className="w-16 h-16 text-muted-foreground/30 mb-4" />
          <h3 className="font-medium text-lg mb-2">No projects found</h3>
          <p className="text-muted-foreground text-sm">
            Start using Claude Code to see projects here
          </p>
        </div>
      )}


      </div>{/* end space-y wrapper */}
    </div>
  );
}
