import { MonitorDown } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function DesktopRequiredMessage() {
  return (
    <div className="flex items-center justify-center h-[60vh]">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 bg-purple-500/20 flex items-center justify-center mx-auto mb-6">
          <MonitorDown className="w-10 h-10 text-purple-600 dark:text-purple-400" />
        </div>
        <h2 className="text-2xl font-bold mb-3">Desktop App Required</h2>
        <p className="text-muted-foreground mb-6">
          The Agent Control Center requires the desktop application to run terminal commands and manage Claude Code agents directly on your machine.
        </p>
        <div className="space-y-3">
          <Alert className="text-left">
            <AlertDescription>
              <p className="text-sm font-medium mb-2">To run the desktop app:</p>
              <code className="block p-2 bg-[#0d0e12] text-primary text-xs font-mono">
                npm run electron:dev
              </code>
            </AlertDescription>
          </Alert>
          <p className="text-xs text-muted-foreground">
            Or build the Mac app with: <code className="text-purple-600 dark:text-purple-400">npm run electron:build</code>
          </p>
        </div>
      </div>
    </div>
  );
}
