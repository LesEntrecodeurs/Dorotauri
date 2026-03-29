
import { AlertCircle, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface StatusIndicatorProps {
  status: string;
}

export function StatusIndicator({ status }: StatusIndicatorProps) {
  if (status === 'waiting') {
    return (
      <div className="absolute -top-3 -right-3 z-20 animate-mount-fade-in">
        <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-warning shadow-lg shadow-warning/50 animate-pulse">
          <AlertCircle className="w-5 h-5 text-white" />
          <span className="absolute inset-0 rounded-full bg-warning animate-ping opacity-75" />
        </div>
      </div>
    );
  }

  if (status === 'running') {
    return (
      <div className="absolute -top-3 -right-3 z-20 animate-mount-fade-in">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 border border-primary shadow-lg shadow-primary/30">
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
        </div>
      </div>
    );
  }

  if (status === 'completed') {
    return (
      <div className="absolute -top-3 -right-3 z-20 animate-mount-fade-in">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-success shadow-lg shadow-success/50">
          <CheckCircle2 className="w-5 h-5 text-white" />
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="absolute -top-3 -right-3 z-20 animate-mount-fade-in">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-destructive shadow-lg shadow-destructive/50">
          <XCircle className="w-5 h-5 text-white" />
        </div>
      </div>
    );
  }

  return null;
}
