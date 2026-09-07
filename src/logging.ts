export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  t: number;
  level: LogLevel;
  tag: string;
  msg: string;
}

const MAX = 200;
const entries: LogEntry[] = [];
const listeners = new Set<(e: LogEntry) => void>();

function push(level: LogLevel, tag: string, msg: string): void {
  const entry = {t: Date.now(), level, tag, msg: String(msg).slice(0, 500)};
  entries.push(entry);
  if (entries.length > MAX) {
    entries.splice(0, entries.length - MAX);
  }
  if (__DEV__) {
    const line = `[${tag}] ${entry.msg}`;
    if (level === 'error') {
      console.warn(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
  listeners.forEach(l => {
    try {
      l(entry);
    } catch {
      // Listener failure must never break logging.
    }
  });
}

export const log = Object.assign(
  (level: LogLevel, tag: string, msg: string) => push(level, tag, msg),
  {
    info: (tag: string, msg: string) => push('info', tag, msg),
    warn: (tag: string, msg: string) => push('warn', tag, msg),
    error: (tag: string, msg: string) => push('error', tag, msg),
  },
);

export function getLogs(): LogEntry[] {
  return [...entries];
}

export function subscribeLogs(fn: (e: LogEntry) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function formatLogs(list: LogEntry[]): string {
  return list
    .map(
      e =>
        `${new Date(e.t).toISOString()} [${e.level.toUpperCase()}] [${e.tag}] ${e.msg}`,
    )
    .join('\n');
}
