

import React from 'react';
import { Bot } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  onNavigateToAgents: () => void;
}

export function EmptyState({ onNavigateToAgents }: EmptyStateProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center z-30 p-4">
      <Card className="text-center p-4 lg:p-8 bg-card/80 max-w-[280px] lg:max-w-md">
        <Bot className="w-8 h-8 lg:w-12 lg:h-12 text-muted-foreground mx-auto mb-3 lg:mb-4" />
        <h3 className="text-base lg:text-lg font-medium text-foreground mb-1.5 lg:mb-2">No agents yet</h3>
        <p className="text-xs lg:text-sm text-muted-foreground mb-3 lg:mb-4">
          Create an agent from the Agents page to see them here.
        </p>
        <Button
          variant="outline"
          onClick={onNavigateToAgents}
          className="text-xs lg:text-sm bg-primary/20 text-primary border-primary/30 hover:bg-primary/30"
        >
          Go to Agents
        </Button>
      </Card>
    </div>
  );
}
