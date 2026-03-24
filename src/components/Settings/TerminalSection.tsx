import { Terminal, Minus, Plus, RotateCcw, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { AppSettings } from './types';

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;
const DEFAULT_FONT_SIZE = 11;

interface TerminalSectionProps {
  appSettings: AppSettings;
  onSaveAppSettings: (updates: Partial<AppSettings>) => void;
}

export const TerminalSection = ({ appSettings, onSaveAppSettings }: TerminalSectionProps) => {
  const currentTheme = appSettings.terminalTheme || 'dark';
  const currentFontSize = appSettings.terminalFontSize || DEFAULT_FONT_SIZE;

  const handleFontSizeChange = (delta: number) => {
    const next = Math.min(Math.max(currentFontSize + delta, MIN_FONT_SIZE), MAX_FONT_SIZE);
    if (next !== currentFontSize) {
      onSaveAppSettings({ terminalFontSize: next });
    }
  };

  const handleFontSizeReset = () => {
    onSaveAppSettings({ terminalFontSize: DEFAULT_FONT_SIZE });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Terminal</h2>
        <p className="text-sm text-muted-foreground">Configure terminal appearance for all views</p>
      </div>

      {/* Theme */}
      <Card>
        <CardContent className="p-6">
          <h3 className="font-medium mb-4">Theme</h3>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            {/* Dark theme card */}
            <button
              onClick={() => onSaveAppSettings({ terminalTheme: 'dark' })}
              className={`relative p-4 border text-left transition-all ${
                currentTheme === 'dark'
                  ? 'border-foreground bg-secondary'
                  : 'border-border hover:border-muted-foreground'
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <Moon className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Dark</span>
              </div>
              {/* Mini preview */}
              <div className="overflow-hidden border border-border">
                <div className="bg-[#1A1726] p-2 h-16 font-mono text-[9px] leading-relaxed">
                  <span className="text-[#22c55e]">$</span>{' '}
                  <span className="text-[#e4e4e7]">npm start</span>
                  <br />
                  <span className="text-primary">ready</span>{' '}
                  <span className="text-[#e4e4e7]">on port 3000</span>
                </div>
              </div>
              {currentTheme === 'dark' && (
                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-foreground" />
              )}
            </button>

            {/* Light theme card */}
            <button
              onClick={() => onSaveAppSettings({ terminalTheme: 'light' })}
              className={`relative p-4 border text-left transition-all ${
                currentTheme === 'light'
                  ? 'border-foreground bg-secondary'
                  : 'border-border hover:border-muted-foreground'
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <Sun className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Light</span>
              </div>
              {/* Mini preview */}
              <div className="overflow-hidden border border-border">
                <div className="bg-[#F8F5FC] p-2 h-16 font-mono text-[9px] leading-relaxed">
                  <span className="text-[#16a34a]">$</span>{' '}
                  <span className="text-[#1E1B4B]">npm start</span>
                  <br />
                  <span className="text-[#7C3AED]">ready</span>{' '}
                  <span className="text-[#1E1B4B]">on port 3000</span>
                </div>
              </div>
              {currentTheme === 'light' && (
                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-foreground" />
              )}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Font Size */}
      <Card>
        <CardContent className="p-6">
          <h3 className="font-medium mb-1">Font Size</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Controls font size on the Terminals page. Persisted across sessions.
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleFontSizeChange(-1)}
              disabled={currentFontSize <= MIN_FONT_SIZE}
              className="h-8 w-8"
            >
              <Minus className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-mono w-8 text-center">{currentFontSize}</span>
              <span className="text-xs text-muted-foreground">px</span>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleFontSizeChange(1)}
              disabled={currentFontSize >= MAX_FONT_SIZE}
              className="h-8 w-8"
            >
              <Plus className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleFontSizeReset}
              disabled={currentFontSize === DEFAULT_FONT_SIZE}
              className="ml-2"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
