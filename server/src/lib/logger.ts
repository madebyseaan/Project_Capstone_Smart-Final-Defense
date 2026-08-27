/**
 * Lightweight, structured logger utility for SMART server.
 * Log Levels: DEBUG (0), INFO (1), WARN (2), ERROR (3)
 * Default LOG_LEVEL is INFO unless overridden by process.env.LOG_LEVEL.
 *
 * Outputs structured JSON in production, human-readable in development.
 * Follows 2026 best practices: timestamps, levels, context objects.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getActiveLogLevel(): number {
  const envLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
  return LOG_LEVELS[envLevel] ?? LOG_LEVELS.info;
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatArgs(level: LogLevel, args: any[]): any[] {
  const ts = timestamp();
  if (process.env.NODE_ENV === 'production') {
    // Structured JSON for production
    const msg = typeof args[0] === 'string' ? args[0] : '';
    const context = args.length > 1 && typeof args[1] === 'object' && args[1] !== null && !(args[1] instanceof Error)
      ? args[1]
      : undefined;
    const error = args.find(a => a instanceof Error);
    const entry: Record<string, any> = { level, timestamp: ts, message: msg };
    if (context) Object.assign(entry, context);
    if (error) {
      entry.error = error.message;
      entry.stack = error.stack;
    }
    // Pass remaining primitive args as 'extra'
    const extras = args.filter(a => a !== msg && a !== context && a !== error && typeof a !== 'object');
    if (extras.length > 0) entry.extra = extras;
    return [JSON.stringify(entry)];
  }
  // Human-readable for development
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  return [prefix, ...args];
}

export const logger = {
  debug: (...args: any[]) => {
    if (getActiveLogLevel() <= LOG_LEVELS.debug) {
      console.log(...formatArgs('debug', args));
    }
  },

  info: (...args: any[]) => {
    if (getActiveLogLevel() <= LOG_LEVELS.info) {
      console.log(...formatArgs('info', args));
    }
  },

  warn: (...args: any[]) => {
    if (getActiveLogLevel() <= LOG_LEVELS.warn) {
      console.warn(...formatArgs('warn', args));
    }
  },

  error: (...args: any[]) => {
    if (getActiveLogLevel() <= LOG_LEVELS.error) {
      console.error(...formatArgs('error', args));
    }
  },
};
