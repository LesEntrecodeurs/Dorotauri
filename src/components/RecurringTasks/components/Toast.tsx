import { useAnimatePresence } from '@/hooks/useAnimatePresence';
import { CheckCircle, XCircle } from 'lucide-react';
import type { Toast as ToastType } from '../types';

interface ToastProps {
  toast: ToastType | null;
}

export function Toast({ toast }: ToastProps) {
  const { shouldRender, animationState } = useAnimatePresence(!!toast);
  return (
    <>
      {shouldRender && toast && (
        <div
          data-state={animationState}
          className={`animate-toast fixed top-4 right-4 z-50 px-4 py-3 shadow-lg flex items-center gap-2 ${
            toast.type === 'success' ? 'bg-success/90 text-white' :
            toast.type === 'error' ? 'bg-destructive/90 text-white' :
            'bg-info/90 text-white'
          }`}
        >
          {toast.type === 'success' && <CheckCircle className="w-4 h-4" />}
          {toast.type === 'error' && <XCircle className="w-4 h-4" />}
          <span className="text-sm font-medium">{toast.message}</span>
        </div>
      )}
    </>
  );
}
