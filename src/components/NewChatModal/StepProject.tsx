import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderOpen,
  FolderPlus,
  Check,
  ChevronDown,
  ChevronRight,
  X,
  Layers,
  Search,
  Star,
  Pin,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Project } from './types';

const INITIAL_VISIBLE = 8;

interface StepProjectProps {
  projects: Project[];
  projectPath: string;
  selectedProject: string;
  customPath: string;
  onSelectProject: (path: string) => void;
  onCustomPathChange: (path: string) => void;
  onBrowseFolder?: () => Promise<string | null>;
  showSecondaryProject: boolean;
  onToggleSecondary: () => void;
  selectedSecondaryProject: string;
  onSelectSecondaryProject: (path: string) => void;
  customSecondaryPath: string;
  onCustomSecondaryPathChange: (path: string) => void;
  onClearSecondary: () => void;
  favoriteProjects?: string[];
  hiddenProjects?: string[];
  defaultProjectPath?: string;
}

const StepProject = React.memo(function StepProject({
  projects,
  projectPath,
  selectedProject,
  customPath,
  onSelectProject,
  onCustomPathChange,
  onBrowseFolder,
  showSecondaryProject,
  onToggleSecondary,
  selectedSecondaryProject,
  onSelectSecondaryProject,
  customSecondaryPath,
  onCustomSecondaryPathChange,
  onClearSecondary,
  favoriteProjects = [],
  hiddenProjects = [],
  defaultProjectPath,
}: StepProjectProps) {
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const isFavorite = (project: Project) => favoriteProjects.includes(project.path);

  const filteredProjects = useMemo(() => {
    const checkFav = (p: Project) => favoriteProjects.includes(p.path);
    const isDefault = (p: Project) => defaultProjectPath === p.path;

    // Filter out hidden projects
    let list = hiddenProjects.length > 0
      ? projects.filter(p => !hiddenProjects.includes(p.path))
      : projects;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
      );
    }
    // Sort: default first, then favorites, then rest
    list = [...list].sort((a, b) => {
      const aRank = isDefault(a) ? 0 : checkFav(a) ? 1 : 2;
      const bRank = isDefault(b) ? 0 : checkFav(b) ? 1 : 2;
      return aRank - bRank;
    });
    return list;
  }, [projects, search, favoriteProjects, hiddenProjects, defaultProjectPath]);

  // When searching, show all results; otherwise cap at INITIAL_VISIBLE unless expanded
  const visibleProjects = search
    ? filteredProjects
    : showAll
      ? filteredProjects
      : filteredProjects.slice(0, INITIAL_VISIBLE);

  const hasMore = !search && filteredProjects.length > INITIAL_VISIBLE && !showAll;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-medium mb-1 flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-primary" />
          Select Project
        </h3>
        <p className="text-muted-foreground text-sm">
          Choose the codebase your agent will work in
        </p>
      </div>

      {/* Search (only show if enough projects to warrant it) */}
      {projects.length > INITIAL_VISIBLE && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setShowAll(false); }}
            placeholder="Search projects..."
            className="pl-10"
          />
        </div>
      )}

      {/* Project Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {visibleProjects.map((project) => (
          <button
            key={project.path}
            onClick={() => onSelectProject(project.path)}
            className={`
              text-left p-3 border transition-all rounded-md
              ${selectedProject === project.path
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary bg-muted/30'
              }
            `}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {defaultProjectPath === project.path ? (
                  <Pin className="w-4 h-4 text-yellow-400" />
                ) : isFavorite(project) ? (
                  <Star className="w-4 h-4 text-yellow-400 fill-current" />
                ) : (
                  <FolderOpen className="w-4 h-4 text-primary" />
                )}
                <span className="font-medium">{project.name}</span>
              </div>
              {selectedProject === project.path && (
                <Check className="w-4 h-4 text-primary" />
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1 truncate font-mono">
              {project.path}
            </p>
          </button>
        ))}
      </div>

      {/* Show All / collapse toggle */}
      {hasMore && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors py-1.5"
        >
          Show all {filteredProjects.length} projects
        </button>
      )}
      {showAll && !search && filteredProjects.length > INITIAL_VISIBLE && (
        <button
          onClick={() => setShowAll(false)}
          className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors py-1.5"
        >
          Show less
        </button>
      )}

      {/* No results */}
      {search && filteredProjects.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-2">No projects match &ldquo;{search}&rdquo;</p>
      )}

      {/* Custom Path */}
      <div className="relative">
        <label className="block text-sm font-medium mb-2">Or enter a custom path:</label>
        <div className="flex gap-2">
          <Input
            type="text"
            value={customPath}
            onChange={(e) => onCustomPathChange(e.target.value)}
            placeholder="/path/to/your/project"
            className="flex-1 font-mono"
          />
          {onBrowseFolder && (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const path = await onBrowseFolder();
                if (path) onCustomPathChange(path);
              }}
            >
              <FolderOpen className="w-4 h-4 text-primary" />
              <span className="text-sm">Browse</span>
            </Button>
          )}
        </div>
      </div>

      {/* Secondary Project (Collapsible) */}
      <div className="border border-border rounded-md overflow-hidden">
        <button
          onClick={onToggleSecondary}
          className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
        >
          <span className="font-medium text-sm flex items-center gap-2">
            {showSecondaryProject ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <Layers className="w-4 h-4 text-primary" />
            Add second project for context (optional)
          </span>
          {(selectedSecondaryProject || customSecondaryPath) && (
            <span className="text-xs text-primary px-2 py-0.5 rounded-md bg-primary/10">
              Selected
            </span>
          )}
        </button>

        <AnimatePresence>
          {showSecondaryProject && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              className="overflow-hidden"
            >
              <div className="p-4 space-y-4 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  The agent will have access to this project via <code className="bg-muted px-1 rounded-sm">--add-dir</code>
                </p>

                {projects.filter(p => p.path !== projectPath).length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {projects.filter(p => p.path !== projectPath).map((project) => (
                      <button
                        key={project.path}
                        onClick={() => onSelectSecondaryProject(project.path)}
                        className={`
                          text-left p-3 border transition-all text-sm rounded-md
                          ${selectedSecondaryProject === project.path
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-primary bg-muted/30'
                          }
                        `}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <FolderPlus className="w-3.5 h-3.5 text-warning" />
                            <span className="font-medium">{project.name}</span>
                          </div>
                          {selectedSecondaryProject === project.path && (
                            <Check className="w-3.5 h-3.5 text-primary" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 truncate font-mono">
                          {project.path}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No other projects available</p>
                )}

                {/* Custom secondary path */}
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={customSecondaryPath}
                    onChange={(e) => onCustomSecondaryPathChange(e.target.value)}
                    placeholder="/path/to/secondary/project"
                    className="flex-1 font-mono"
                  />
                  {onBrowseFolder && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={async () => {
                        const path = await onBrowseFolder();
                        if (path) onCustomSecondaryPathChange(path);
                      }}
                    >
                      <FolderOpen className="w-4 h-4 text-primary" />
                      <span className="text-sm">Browse</span>
                    </Button>
                  )}
                </div>

                {/* Clear button */}
                {(selectedSecondaryProject || customSecondaryPath) && (
                  <button
                    onClick={onClearSecondary}
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
                  >
                    <X className="w-3 h-3" />
                    Clear selection
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});

export default StepProject;
