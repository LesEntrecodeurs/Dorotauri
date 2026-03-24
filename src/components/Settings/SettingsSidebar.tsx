import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SECTIONS } from './constants';
import type { SettingsSection } from './types';

interface SettingsSidebarProps {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

export const SettingsSidebar = ({ activeSection, onSectionChange }: SettingsSidebarProps) => {
  return (
    <>
      {/* Desktop Sidebar */}
      <nav className="w-48 shrink-0 hidden lg:block">
        <div className="space-y-1">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <Button
                key={section.id}
                variant="ghost"
                onClick={() => onSectionChange(section.id)}
                className={`w-full justify-start gap-3 px-3 py-2.5 text-sm ${isActive
                  ? 'bg-secondary text-foreground border-l-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  }`}
              >
                <Icon className="w-4 h-4" />
                <span>{section.label}</span>
                {isActive && <ChevronRight className="w-4 h-4 ml-auto" />}
              </Button>
            );
          })}
        </div>
      </nav>

      {/* Mobile Section Selector */}
      <div className="lg:hidden mb-4 shrink-0">
        <Select
          value={activeSection}
          onValueChange={(value) => onSectionChange(value as SettingsSection)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SECTIONS.map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
};
