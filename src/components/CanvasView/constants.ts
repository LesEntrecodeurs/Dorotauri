export const CANVAS_STATE_KEY = 'canvas-board-state';

export const STATUS_COLORS: Record<string, string> = {
  running: 'bg-success',
  waiting: 'bg-warning',
  idle: 'bg-muted-foreground',
  stopped: 'bg-muted-foreground/60',
  error: 'bg-destructive',
  completed: 'bg-primary',
};

export const CHARACTER_EMOJIS: Record<string, string> = {
  robot: '\u{1F916}',
  ninja: '\u{1F977}',
  wizard: '\u{1F9D9}',
  astronaut: '\u{1F468}\u{200D}\u{1F680}',
  alien: '\u{1F47D}',
  cat: '\u{1F431}',
  dog: '\u{1F415}',
  frog: '\u{1F438}',
  knight: '\u2694\uFE0F',
  pirate: '\u{1F3F4}\u{200D}\u2620\uFE0F',
  viking: '\u{1F6E1}\uFE0F',
};

export const SUPER_AGENT_STATUS_COLORS: Record<string, { dot: string; pulse: boolean }> = {
  running: { dot: 'bg-success', pulse: true },
  waiting: { dot: 'bg-warning', pulse: true },
  idle: { dot: 'bg-muted-foreground', pulse: false },
  completed: { dot: 'bg-primary', pulse: false },
  error: { dot: 'bg-destructive', pulse: false },
};

export const DRAG_THRESHOLD = 5;
