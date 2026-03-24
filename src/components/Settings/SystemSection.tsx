import { FolderOpen } from 'lucide-react';
import { Toggle } from './Toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { ClaudeInfo, AppSettings } from './types';

interface SystemSectionProps {
  info: ClaudeInfo | null;
  appSettings: AppSettings;
  onSaveAppSettings: (settings: Partial<AppSettings>) => void;
}

export const SystemSection = ({ info, appSettings, onSaveAppSettings }: SystemSectionProps) => {
  const handleOpenConfigFolder = () => {
    if (info?.configPath && window.electronAPI?.shell) {
      window.electronAPI.shell.exec({ command: `open "${info.configPath}"` });
    }
  };

  const handleVerboseModeToggle = () => {
    onSaveAppSettings({ verboseModeEnabled: !appSettings.verboseModeEnabled });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">System Information</h2>
        <p className="text-sm text-muted-foreground">Claude Code installation details</p>
      </div>

      {/* Agent Settings */}
      <Card>
        <CardContent className="p-6">
          <h3 className="text-md font-medium mb-4">Agent Settings</h3>
          <div className="flex items-center justify-between py-3">
            <div>
              <span className="text-sm">Verbose Mode</span>
              <p className="text-xs text-muted-foreground mt-1">
                Start agents with --verbose flag for detailed output
              </p>
            </div>
            <Toggle
              enabled={appSettings.verboseModeEnabled}
              onChange={handleVerboseModeToggle}
            />
          </div>
        </CardContent>
      </Card>

      {info && (
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="flex justify-between py-3">
                <span className="text-sm text-muted-foreground">Claude Version</span>
                <span className="text-sm font-mono">{info.claudeVersion || 'Not found'}</span>
              </div>
              <Separator />
              <div className="flex justify-between py-3">
                <span className="text-sm text-muted-foreground">Platform</span>
                <span className="text-sm font-mono">{info.platform} ({info.arch})</span>
              </div>
              <Separator />
              <div className="flex justify-between py-3">
                <span className="text-sm text-muted-foreground">Electron</span>
                <span className="text-sm font-mono">{info.electronVersion}</span>
              </div>
              <Separator />
              <div className="flex justify-between py-3">
                <span className="text-sm text-muted-foreground">Node.js</span>
                <span className="text-sm font-mono">{info.nodeVersion}</span>
              </div>
              <Separator />
              <div className="flex justify-between py-3">
                <span className="text-sm text-muted-foreground">Config Path</span>
                <span className="text-sm font-mono text-muted-foreground truncate max-w-[200px]">{info.configPath}</span>
              </div>
              <Separator />
              <div className="pt-4">
                <Button
                  variant="secondary"
                  onClick={handleOpenConfigFolder}
                >
                  <FolderOpen className="w-4 h-4" />
                  Open Config Folder
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
