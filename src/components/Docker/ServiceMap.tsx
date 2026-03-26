import { useEffect, useRef, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Loader2 } from 'lucide-react';
import type { NetworkMap, NetworkMapNode } from '@/types/docker';

// ── Physics constants ───────────────────────────────────────────────────────

const REPULSION = 12000;
const ATTRACTION = 0.012;
const PROJECT_ATTRACTION = 0.03;
const DAMPING = 0.85;
const NODE_RADIUS = 28;
const PARTICLE_SPEED = 0.008; // How fast particles travel along edges

// ── Colors ──────────────────────────────────────────────────────────────────

const STATE_COLORS: Record<string, string> = {
  running: '#4ade80',
  exited: '#f87171',
  paused: '#facc15',
  restarting: '#fb923c',
  created: '#94a3b8',
};

const NETWORK_COLORS = [
  '#60a5fa', '#c084fc', '#22d3ee', '#fb923c', '#a78bfa',
  '#f472b6', '#34d399', '#fbbf24', '#e879f9', '#2dd4bf',
];

function getStateColor(state: string): string {
  return STATE_COLORS[state] || '#71717a';
}

// ── Graph node with physics ─────────────────────────────────────────────────

interface GraphNode {
  id: string;
  name: string;
  image: string;
  state: string;
  project: string | null;
  ports: string;
  networks: string[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
}

interface GraphEdge {
  network: string;
  from: string;
  to: string;
  color: string;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ServiceMap({ onSelectContainer }: { onSelectContainer?: (id: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const dragRef = useRef<{ nodeId: string | null; panStart: { x: number; y: number } | null }>({ nodeId: null, panStart: null });
  const transformRef = useRef({ ox: 0, oy: 0, scale: 1 });
  const hoverRef = useRef<string | null>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch network map
  const fetchMap = useCallback(async () => {
    try {
      const map = await invoke<NetworkMap>('docker_network_map');
      const cx = 400, cy = 300;

      const nodes: GraphNode[] = map.nodes.map((n, i) => {
        const angle = (2 * Math.PI * i) / Math.max(map.nodes.length, 1);
        const r = 120 + Math.random() * 80;
        return {
          ...n,
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
          vx: 0, vy: 0, fixed: false,
        };
      });

      // Build edges: for each network, create edges between all container pairs
      const networkColorMap = new Map<string, string>();
      const edges: GraphEdge[] = [];

      for (const edge of map.edges) {
        if (!networkColorMap.has(edge.network)) {
          networkColorMap.set(edge.network, NETWORK_COLORS[networkColorMap.size % NETWORK_COLORS.length]);
        }
        const color = networkColorMap.get(edge.network)!;

        for (let i = 0; i < edge.containers.length; i++) {
          for (let j = i + 1; j < edge.containers.length; j++) {
            const fromNode = nodes.find(n => n.id.startsWith(edge.containers[i]));
            const toNode = nodes.find(n => n.id.startsWith(edge.containers[j]));
            if (fromNode && toNode) {
              edges.push({ network: edge.network, from: fromNode.id, to: toNode.id, color });
            }
          }
        }
      }

      graphRef.current = { nodes, edges };
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMap(); }, [fetchMap]);

  // Physics simulation + render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const loop = () => {
      const { nodes, edges } = graphRef.current;
      const { ox, oy, scale } = transformRef.current;

      // Resize canvas
      const parent = containerRef.current;
      if (parent) {
        const dpr = window.devicePixelRatio || 1;
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
          canvas.width = w * dpr;
          canvas.height = h * dpr;
          canvas.style.width = `${w}px`;
          canvas.style.height = `${h}px`;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
      }

      const W = canvas.clientWidth;
      const H = canvas.clientHeight;

      // Physics step
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].fixed) continue;
        let fx = 0, fy = 0;

        // Repulsion from all other nodes
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d2 = dx * dx + dy * dy + 1;
          const f = REPULSION / d2;
          fx += (dx / Math.sqrt(d2)) * f;
          fy += (dy / Math.sqrt(d2)) * f;
        }

        // Attraction along edges
        for (const e of edges) {
          let other: GraphNode | undefined;
          if (e.from === nodes[i].id) other = nodes.find(n => n.id === e.to);
          else if (e.to === nodes[i].id) other = nodes.find(n => n.id === e.from);
          if (!other) continue;

          const dx = other.x - nodes[i].x;
          const dy = other.y - nodes[i].y;
          const attraction = (nodes[i].project && nodes[i].project === other.project)
            ? PROJECT_ATTRACTION : ATTRACTION;
          fx += dx * attraction;
          fy += dy * attraction;
        }

        // Center gravity
        fx += (W / 2 - nodes[i].x) * 0.001;
        fy += (H / 2 - nodes[i].y) * 0.001;

        nodes[i].vx = (nodes[i].vx + fx) * DAMPING;
        nodes[i].vy = (nodes[i].vy + fy) * DAMPING;
        nodes[i].x += nodes[i].vx;
        nodes[i].y += nodes[i].vy;
      }

      // Clear
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);

      const hoverId = hoverRef.current;
      const t = performance.now() * 0.06; // ~60 units per second, always increasing

      // Draw edges + animated particles
      for (let ei = 0; ei < edges.length; ei++) {
        const e = edges[ei];
        const from = nodes.find(n => n.id === e.from);
        const to = nodes.find(n => n.id === e.to);
        if (!from || !to) continue;

        const isHighlighted = hoverId === from.id || hoverId === to.id;

        // Edge line — dashed for cyberpunk grid feel
        ctx.beginPath();
        ctx.setLineDash(isHighlighted ? [] : [4, 4]);
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = isHighlighted ? e.color : `${e.color}30`;
        ctx.lineWidth = isHighlighted ? 2 : 1;
        ctx.stroke();
        ctx.setLineDash([]);

        // Network label at midpoint
        if (isHighlighted) {
          const mx = (from.x + to.x) / 2;
          const my = (from.y + to.y) / 2;
          ctx.font = '9px sans-serif';
          ctx.fillStyle = e.color;
          ctx.textAlign = 'center';
          ctx.fillText(e.network, mx, my - 6);
        }

        // Animated data particles — cyberpunk style
        const fromRunning = from.state === 'running';
        const toRunning = to.state === 'running';
        if (fromRunning && toRunning) {
          const particleCount = 5;
          for (let p = 0; p < particleCount; p++) {
            const offset = p / particleCount;
            const progress = ((t * PARTICLE_SPEED + offset + ei * 0.13) % 1);

            const px = from.x + (to.x - from.x) * progress;
            const py = from.y + (to.y - from.y) * progress;

            // Fade in/out at edges
            const alpha = Math.sin(progress * Math.PI);

            // Neon cyan glow trail
            ctx.shadowColor = '#00fff2';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(px, py, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0, 255, 242, ${alpha * 0.9})`;
            ctx.fill();

            // Tiny inner white core
            ctx.shadowBlur = 0;
            ctx.beginPath();
            ctx.arc(px, py, 0.6, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
            ctx.fill();
            ctx.shadowColor = 'transparent';
          }
        }
      }

      // Draw nodes — cyberpunk hexagonal style
      for (const node of nodes) {
        const isHover = hoverId === node.id;
        const r = isHover ? NODE_RADIUS * 1.15 : NODE_RADIUS;
        const color = getStateColor(node.state);
        const pulse = Math.sin(t * 0.05 + node.x * 0.01) * 0.15 + 0.85;

        // Outer neon glow (always on, subtle)
        ctx.shadowColor = color;
        ctx.shadowBlur = isHover ? 25 : 10;

        // Hexagon path
        ctx.beginPath();
        for (let s = 0; s < 6; s++) {
          const angle = (Math.PI / 3) * s - Math.PI / 6;
          const hx = node.x + r * Math.cos(angle);
          const hy = node.y + r * Math.sin(angle);
          s === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy);
        }
        ctx.closePath();

        // Dark fill with subtle color tint
        ctx.fillStyle = `${color}15`;
        ctx.fill();

        // Neon border
        ctx.strokeStyle = isHover ? color : `${color}${Math.round(pulse * 200).toString(16).padStart(2, '0')}`;
        ctx.lineWidth = isHover ? 2.5 : 1.5;
        ctx.stroke();

        // Inner ring (scanning effect)
        const scanAngle = (t * 0.03 + node.y * 0.01) % (Math.PI * 2);
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 0.65, scanAngle, scanAngle + Math.PI * 0.5);
        ctx.strokeStyle = `${color}30`;
        ctx.lineWidth = 0.5;
        ctx.stroke();

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // Name — monospace for cyberpunk feel
        ctx.font = `${isHover ? 'bold ' : ''}10px 'JetBrains Mono', 'Courier New', monospace`;
        ctx.fillStyle = '#e4e4e7';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.name, node.x, node.y - 3);

        // Image
        ctx.font = "7px 'JetBrains Mono', monospace";
        ctx.fillStyle = '#71717a';
        const shortImage = node.image.split(':')[0].split('/').pop() || node.image;
        ctx.fillText(shortImage, node.x, node.y + 9);

        // Status dot
        ctx.beginPath();
        ctx.arc(node.x + r * 0.7, node.y - r * 0.7, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // Ports on hover
        if (isHover && node.ports) {
          ctx.font = "8px 'JetBrains Mono', monospace";
          ctx.fillStyle = '#00fff2';
          ctx.fillText(node.ports.split(',')[0]?.trim() || '', node.x, node.y + r + 14);
        }

        // Project label
        if (node.project) {
          ctx.font = "7px 'JetBrains Mono', monospace";
          ctx.fillStyle = '#a78bfa60';
          ctx.fillText(`[${node.project}]`, node.x, node.y - r - 8);
        }
      }

      // Legend
      ctx.restore();
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      let ly = 12;
      for (const [state, color] of Object.entries(STATE_COLORS)) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(16, ly + 5, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#a1a1aa';
        ctx.fillText(state, 26, ly);
        ly += 18;
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [loading]);

  // Mouse interaction
  const screenToGraph = useCallback((ex: number, ey: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const { ox, oy, scale } = transformRef.current;
    return { x: (ex - rect.left - ox) / scale, y: (ey - rect.top - oy) / scale };
  }, []);

  const findNode = useCallback((ex: number, ey: number): GraphNode | undefined => {
    const { x, y } = screenToGraph(ex, ey);
    return graphRef.current.nodes.find(n => {
      const dx = n.x - x, dy = n.y - y;
      return dx * dx + dy * dy < NODE_RADIUS * NODE_RADIUS * 1.5;
    });
  }, [screenToGraph]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const { x, y } = screenToGraph(e.clientX, e.clientY);

    if (dragRef.current.nodeId) {
      const node = graphRef.current.nodes.find(n => n.id === dragRef.current.nodeId);
      if (node) { node.x = x; node.y = y; node.vx = 0; node.vy = 0; }
    } else if (dragRef.current.panStart) {
      const { x: sx, y: sy } = dragRef.current.panStart;
      transformRef.current.ox += e.clientX - sx;
      transformRef.current.oy += e.clientY - sy;
      dragRef.current.panStart = { x: e.clientX, y: e.clientY };
    }

    const hit = findNode(e.clientX, e.clientY);
    hoverRef.current = hit?.id || null;
    if (canvasRef.current) canvasRef.current.style.cursor = hit ? 'pointer' : 'default';
  }, [screenToGraph, findNode]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const hit = findNode(e.clientX, e.clientY);
    if (hit) { dragRef.current.nodeId = hit.id; hit.fixed = true; }
    else dragRef.current.panStart = { x: e.clientX, y: e.clientY };
  }, [findNode]);

  const handleMouseUp = useCallback(() => {
    if (dragRef.current.nodeId) {
      const node = graphRef.current.nodes.find(n => n.id === dragRef.current.nodeId);
      if (node) node.fixed = false;
    }
    dragRef.current.nodeId = null;
    dragRef.current.panStart = null;
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const hit = findNode(e.clientX, e.clientY);
    if (hit && onSelectContainer) onSelectContainer(hit.id);
  }, [findNode, onSelectContainer]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const t = transformRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    t.ox = mx - (mx - t.ox) * delta;
    t.oy = my - (my - t.oy) * delta;
    t.scale *= delta;
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  if (graphRef.current.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No containers to display
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 min-h-0 relative bg-[#0a0a1a] rounded-lg overflow-hidden">
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
        onWheel={handleWheel}
      />
      <div className="absolute bottom-2 right-2 text-[9px] text-white/20">
        Scroll to zoom · drag to pan · click node for details
      </div>
    </div>
  );
}
