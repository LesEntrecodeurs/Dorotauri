

import { motion } from 'framer-motion';
import { BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ClaudeStats } from '@/lib/claude-code';

interface UsageChartProps {
  stats: ClaudeStats | null | undefined;
}

export default function UsageChart({ stats }: UsageChartProps) {
  if (!stats?.dailyActivity) return null;

  // Get last 10 days of activity
  const recentActivity = [...stats.dailyActivity].slice(-10);
  const maxMessages = Math.max(...recentActivity.map(d => d.messageCount));

  return (
    <Card className="overflow-hidden">
      <CardHeader className="px-5 py-4 border-b border-border flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-medium">Daily Activity</CardTitle>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <span>Messages</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-chart-2" />
            <span>Tool Calls</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-5">
        <div className="flex items-end gap-2 h-40">
          {recentActivity.map((day, index) => {
            const messageHeight = maxMessages > 0 ? (day.messageCount / maxMessages) * 100 : 0;
            const toolHeight = maxMessages > 0 ? (day.toolCallCount / maxMessages) * 100 : 0;
            const date = new Date(day.date);

            return (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex gap-0.5 items-end h-32">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${messageHeight}%` }}
                    transition={{ delay: index * 0.05, duration: 0.3 }}
                    className="flex-1 bg-primary/80"
                    title={`${day.messageCount} messages`}
                  />
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${toolHeight}%` }}
                    transition={{ delay: index * 0.05 + 0.1, duration: 0.3 }}
                    className="flex-1 bg-chart-2/80"
                    title={`${day.toolCallCount} tool calls`}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {date.getDate()}/{date.getMonth() + 1}
                </span>
              </div>
            );
          })}
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-border">
          <div className="text-center">
            <p className="text-2xl font-bold text-primary">
              {stats.totalMessages.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">Total Messages</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-chart-2">
              {stats.totalSessions}
            </p>
            <p className="text-xs text-muted-foreground">Total Sessions</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-success">
              {stats.longestSession?.messageCount || 0}
            </p>
            <p className="text-xs text-muted-foreground">Longest Session</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
