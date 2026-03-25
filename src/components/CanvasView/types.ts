export interface AgentNode {
  id: string;
  type: 'agent';
  name: string;
  character: string;
  status: 'running' | 'inactive' | 'dormant' | 'waiting' | 'error' | 'completed';
  skills: string[];
  cwd: string;
  position: { x: number; y: number };
}

export interface ProjectNode {
  id: string;
  type: 'project';
  name: string;
  path: string;
  branch?: string;
  position: { x: number; y: number };
  agentIds: string[];
}

export interface CanvasState {
  agentPositions: Record<string, { x: number; y: number }>;
  projectPositions: Record<string, { x: number; y: number }>;
  panOffset: { x: number; y: number };
  zoom: number;
  notificationPanelCollapsed: boolean;
}

export interface ConnectionData {
  from: { x: number; y: number };
  to: { x: number; y: number };
  isActive: boolean;
}
