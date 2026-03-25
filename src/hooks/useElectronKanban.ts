import { useEffect, useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@/hooks/useTauri';
import type { KanbanTask, KanbanColumn, KanbanTaskCreate, KanbanTaskUpdate, KanbanMoveResult } from '@/types/kanban';
import type { Agent } from '@/types/electron';

/**
 * Hook for Kanban board management via Tauri invoke
 */
export function useElectronKanban() {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all tasks
  const fetchTasks = useCallback(async () => {
    if (!isTauri()) {
      setIsLoading(false);
      return;
    }

    try {
      const result = await invoke<{ tasks: KanbanTask[]; error?: string }>('kanban_list');
      if (result.error) {
        setError(result.error);
      } else {
        setTasks(result.tasks as KanbanTask[]);
        setError(null);
      }
    } catch {
      // Rust commands not implemented yet — return empty
      setIsLoading(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Create a new task
  // Note: State is updated via onTaskCreated event to avoid duplicates
  const createTask = useCallback(async (params: KanbanTaskCreate) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }

    try {
      const result = await invoke<{ success: boolean; task?: KanbanTask; error?: string }>('kanban_create', { params });
      return result;
    } catch (err) {
      throw err;
    }
  }, []);

  // Update a task
  // Note: State is updated via onTaskUpdated event
  const updateTask = useCallback(async (params: KanbanTaskUpdate) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }

    try {
      const result = await invoke<{ success: boolean; task?: KanbanTask; error?: string }>('kanban_update', { params });
      return result;
    } catch (err) {
      throw err;
    }
  }, []);

  // Move a task to a different column
  // Note: State is updated via onTaskUpdated event
  const moveTask = useCallback(async (
    id: string,
    column: KanbanColumn,
    order?: number
  ): Promise<KanbanMoveResult> => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }

    try {
      const result = await invoke<KanbanMoveResult>('kanban_move', { id, column, order });
      return result;
    } catch (err) {
      throw err;
    }
  }, []);

  // Delete a task
  // Note: State is updated via onTaskDeleted event
  const deleteTask = useCallback(async (id: string) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }

    try {
      const result = await invoke<{ success: boolean; error?: string }>('kanban_delete', { id });
      return result;
    } catch (err) {
      throw err;
    }
  }, []);

  // Reorder tasks within a column
  // Note: State is updated via onTaskUpdated events
  const reorderTasks = useCallback(async (taskIds: string[], column: KanbanColumn) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }

    try {
      const result = await invoke<{ success: boolean; error?: string }>('kanban_reorder', { taskIds, column });
      return result;
    } catch (err) {
      throw err;
    }
  }, []);

  // Get tasks by column
  const getTasksByColumn = useCallback((column: KanbanColumn): KanbanTask[] => {
    return tasks
      .filter(t => t.column === column)
      .sort((a, b) => a.order - b.order);
  }, [tasks]);

  // Subscribe to real-time events
  useEffect(() => {
    if (!isTauri()) return;

    const unlistenFns: (() => void)[] = [];

    listen<KanbanTask>('kanban:task_created', (event) => {
      const task = event.payload;
      setTasks(prev => {
        // Check if task already exists (might have been added by our own action)
        if (prev.some(t => t.id === task.id)) {
          return prev;
        }
        return [...prev, task as KanbanTask];
      });
    }).then(fn => unlistenFns.push(fn));

    listen<KanbanTask>('kanban:task_updated', (event) => {
      const task = event.payload;
      setTasks(prev => prev.map(t => t.id === task.id ? task as KanbanTask : t));
    }).then(fn => unlistenFns.push(fn));

    listen<{ id: string }>('kanban:task_deleted', (event) => {
      setTasks(prev => prev.filter(t => t.id !== event.payload.id));
    }).then(fn => unlistenFns.push(fn));

    return () => {
      unlistenFns.forEach(fn => fn());
    };
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return {
    tasks,
    isLoading,
    error,
    isElectron: isTauri(),
    createTask,
    updateTask,
    moveTask,
    deleteTask,
    reorderTasks,
    getTasksByColumn,
    refresh: fetchTasks,
  };
}

/**
 * Hook to sync agent events with kanban tasks
 * Updates task progress and moves to "done" when agent completes
 */
export function useKanbanAgentSync(
  tasks: KanbanTask[],
  updateTask: (params: KanbanTaskUpdate) => Promise<unknown>,
  moveTask: (id: string, column: KanbanColumn) => Promise<unknown>
) {
  // Use ref to always have latest tasks without re-subscribing
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const updateTaskRef = useRef(updateTask);
  updateTaskRef.current = updateTask;

  const moveTaskRef = useRef(moveTask);
  moveTaskRef.current = moveTask;

  useEffect(() => {
    if (!isTauri()) return;

    console.log('[Kanban Sync] Setting up agent event listeners');

    const unlistenFns: (() => void)[] = [];

    // Listen to agent status changes - only for progress updates, NOT for completion
    listen<{ agentId: string; status: string; timestamp: string }>('agent:status', (event) => {
      const e = event.payload;
      // Find task assigned to this agent
      const task = tasksRef.current.find(t => t.assignedAgentId === e.agentId);
      if (!task || task.column !== 'ongoing') return;

      // Only update progress for running status, NOT for completion
      if (e.status === 'running' && task.progress < 50) {
        updateTaskRef.current({ id: task.id, progress: 50 });
      }
    }).then(fn => unlistenFns.push(fn));

    // onComplete fires when PTY actually exits - this is the reliable completion signal
    listen<{ agentId: string; exitCode?: number }>('agent:complete', async (event) => {
      const e = event.payload;
      console.log(`[Kanban Sync] Received complete event:`, e);

      const task = tasksRef.current.find(t => t.assignedAgentId === e.agentId);
      if (!task) {
        console.log(`[Kanban Sync] No task found for agent ${e.agentId}`);
        return;
      }

      console.log(`[Kanban Sync] Agent ${e.agentId} completed with exit code: ${e.exitCode} for task "${task.title}"`);

      if (task.column === 'ongoing') {
        const isSuccess = e.exitCode === 0;
        console.log(`[Kanban Sync] Moving task ${task.id} to done (success: ${isSuccess})`);

        // Get agent output for completion summary
        let completionSummary = isSuccess ? 'Task completed successfully.' : 'Task completed with errors.';
        try {
          const agent = await invoke<Agent | null>('agent_get', { id: e.agentId });
          if (agent?.output && agent.output.length > 0) {
            // Get last 50 lines of output as summary (or less if not available)
            const outputLines = agent.output.slice(-50);
            completionSummary = outputLines.join('');
          }
        } catch (err) {
          console.error('[Kanban Sync] Failed to get agent output:', err);
        }

        updateTaskRef.current({ id: task.id, progress: 100, completionSummary });
        moveTaskRef.current(task.id, 'done');
      }
    }).then(fn => unlistenFns.push(fn));

    return () => {
      unlistenFns.forEach(fn => fn());
    };
  }, []); // Empty deps - we use refs to avoid re-subscribing
}
