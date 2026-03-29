

import { Radio } from 'lucide-react';
import { useAnimatePresence } from '@/hooks/useAnimatePresence';

interface BroadcastIndicatorProps {
  active: boolean;
}

export default function BroadcastIndicator({ active }: BroadcastIndicatorProps) {
  const { shouldRender, animationState } = useAnimatePresence(active);
  return (
    <>
      {shouldRender && (
        <div
          data-state={animationState}
          className="animate-fade fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 bg-primary/20 border border-primary/30 backdrop-blur-sm"
        >
          <Radio className="w-4 h-4 text-primary animate-pulse" />
          <span className="text-xs font-medium text-primary">
            Broadcast Mode Active — Input is sent to all terminals
          </span>
        </div>
      )}
    </>
  );
}
