import { Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyAgentStateProps {
  onCreateAgent: () => void;
}

export function EmptyAgentState({ onCreateAgent }: EmptyAgentStateProps) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <Bot className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
        <h3 className="font-medium text-lg mb-2">Select an Agent</h3>
        <p className="text-muted-foreground text-sm mb-4">
          Choose an agent from the list or create a new one
        </p>
        <Button
          onClick={onCreateAgent}
          variant="link"
          className="text-primary"
        >
          Create new agent
        </Button>
      </div>
    </div>
  );
}
