import { Switch } from '@/components/ui/switch';

interface ToggleProps {
  enabled: boolean;
  onChange: () => void;
  disabled?: boolean;
}

export const Toggle = ({ enabled, onChange, disabled }: ToggleProps) => (
  <Switch
    checked={enabled}
    onCheckedChange={onChange}
    disabled={disabled}
  />
);
