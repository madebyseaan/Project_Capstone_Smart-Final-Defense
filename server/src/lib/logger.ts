/**
 * Lightweight, structured logger utility for SMART server.
 * Log Levels: DEBUG (0), INFO (1), WARN (2), ERROR (3)
 * Default LOG_LEVEL is INFO unless overridden by process.env.LOG_LEVEL.
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

export const logger = {
  debug: (...args: any[]) => {
    if (getActiveLogLevel() <= LOG_LEVELS.debug) {
      console.log(...args);
    }
  },

  info: (...args: any[]) => {
    if (getActiveLogLevel() <= LOG_LEVELS.info) {
      console.log(...args);
    }
  },

  warn: (...args: any[]) => {
    if (getActiveLogLevel() <= LOG_LEVELS.warn) {
      console.warn(...args);
    }
  },

  error: (...args: any[]) => {
    if (getActiveLogLevel() <= LOG_LEVELS.error) {
      console.error(...args);
    }
  },
};
