

import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface StatusIndicatorProps {
  status: string;
}

export function StatusIndicator({ status }: StatusIndicatorProps) {
  if (status === 'waiting') {
    return (
      <motion.div
        className="absolute -top-3 -right-3 z-20"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
      >
        <motion.div
          className="relative flex items-center justify-center w-8 h-8 rounded-full bg-warning shadow-lg shadow-warning/50"
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          <AlertCircle className="w-5 h-5 text-white" />
          <span className="absolute inset-0 rounded-full bg-warning animate-ping opacity-75" />
        </motion.div>
      </motion.div>
    );
  }

  if (status === 'running') {
    return (
      <motion.div
        className="absolute -top-3 -right-3 z-20"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 border border-primary shadow-lg shadow-primary/30">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          >
            <Loader2 className="w-4 h-4 text-primary" />
          </motion.div>
        </div>
      </motion.div>
    );
  }

  if (status === 'completed') {
    return (
      <motion.div
        className="absolute -top-3 -right-3 z-20"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-success shadow-lg shadow-success/50">
          <CheckCircle2 className="w-5 h-5 text-white" />
        </div>
      </motion.div>
    );
  }

  if (status === 'error') {
    return (
      <motion.div
        className="absolute -top-3 -right-3 z-20"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-destructive shadow-lg shadow-destructive/50">
          <XCircle className="w-5 h-5 text-white" />
        </div>
      </motion.div>
    );
  }

  return null;
}
