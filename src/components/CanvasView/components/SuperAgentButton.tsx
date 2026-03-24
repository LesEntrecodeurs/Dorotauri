

import React from 'react';
import { motion } from 'framer-motion';
import { Crown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SUPER_AGENT_STATUS_COLORS } from '../constants';

interface SuperAgentButtonProps {
  superAgent: { id: string; status: string } | null;
  isCreating: boolean;
  onClick: () => void;
}

export function SuperAgentButton({ superAgent, isCreating, onClick }: SuperAgentButtonProps) {
  const statusColor = superAgent ? SUPER_AGENT_STATUS_COLORS[superAgent.status] || SUPER_AGENT_STATUS_COLORS.idle : null;

  return (
    <motion.button
      onClick={onClick}
      disabled={isCreating}
      className={cn(
        'flex items-center gap-2 px-3 py-2 border backdrop-blur-sm transition-all duration-200',
        superAgent
          ? superAgent.status === 'running' || superAgent.status === 'waiting'
            ? 'bg-chart-2/20 border-chart-2/50 text-chart-2 hover:bg-chart-2/30 shadow-lg shadow-chart-2/20'
            : 'bg-card/90 border-chart-2/30 text-chart-2 hover:bg-chart-2/10 hover:border-chart-2/50'
          : 'bg-card/90 border-border text-foreground hover:bg-secondary hover:border-chart-2/50',
        'disabled:opacity-50 disabled:cursor-not-allowed'
      )}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      title={superAgent ? `Super Agent (${superAgent.status})` : 'Create Super Agent'}
    >
      {isCreating ? (
        <Loader2 className="w-4 h-4 animate-spin text-chart-2" />
      ) : (
        <div className="relative">
          <Crown className={cn('w-4 h-4', superAgent ? 'text-warning' : 'text-muted-foreground')} />
          {superAgent && statusColor && (
            <span className={cn('absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-card', statusColor.dot, statusColor.pulse && 'animate-pulse')} />
          )}
        </div>
      )}
      <span className="text-xs font-medium hidden sm:inline">
        {isCreating ? 'Creating...' : 'Super Agent'}
      </span>
    </motion.button>
  );
}
