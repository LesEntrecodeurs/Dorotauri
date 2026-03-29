

import { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  color: 'cyan' | 'green' | 'amber' | 'purple' | 'red' | 'blue';
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

const colorMap = {
  cyan: {
    bg: 'bg-primary/10',
    text: 'text-primary',
  },
  green: {
    bg: 'bg-success/10',
    text: 'text-success',
  },
  amber: {
    bg: 'bg-warning/10',
    text: 'text-warning',
  },
  purple: {
    bg: 'bg-primary/10',
    text: 'text-primary',
  },
  red: {
    bg: 'bg-destructive/10',
    text: 'text-destructive',
  },
  blue: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-500',
  },
};

export default function StatsCard({ title, value, subtitle, icon: Icon, color, trend }: StatsCardProps) {
  const colors = colorMap[color];

  return (
    <div className="animate-mount-fade-up">
      <Card className="relative overflow-hidden p-6 transition-all duration-200 hover:border-primary/30">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold tracking-tight text-foreground">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
            {trend && (
              <div className={`flex items-center gap-1 text-xs font-semibold ${trend.isPositive ? 'text-success' : 'text-destructive'}`}>
                <span>{trend.isPositive ? '\u2191' : '\u2193'}</span>
                <span>{Math.abs(trend.value)}%</span>
                <span className="text-muted-foreground font-normal">vs yesterday</span>
              </div>
            )}
          </div>
          <div className={`${colors.bg} ${colors.text} p-3`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </Card>
    </div>
  );
}
