/**
 * Structured Logger Utility
 * Provides consistent logging with timestamps, levels, and tags
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// ANSI color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

// Level labels with colors
const levelLabels: Record<LogLevel, { label: string; color: string }> = {
  [LogLevel.DEBUG]: { label: "DEBUG", color: colors.gray },
  [LogLevel.INFO]: { label: "INFO ", color: colors.blue },
  [LogLevel.WARN]: { label: "WARN ", color: colors.yellow },
  [LogLevel.ERROR]: { label: "ERROR", color: colors.red },
};

// Current log level (can be set via environment)
const currentLevel: LogLevel = (() => {
  const envLevel = process.env.LOG_LEVEL?.toUpperCase();
  switch (envLevel) {
    case "DEBUG":
      return LogLevel.DEBUG;
    case "INFO":
      return LogLevel.INFO;
    case "WARN":
      return LogLevel.WARN;
    case "ERROR":
      return LogLevel.ERROR;
    default:
      return process.env.NODE_ENV === "production" ? LogLevel.INFO : LogLevel.DEBUG;
  }
})();

// Check if colors should be used (disable in CI/non-TTY)
const useColors = process.stdout.isTTY && process.env.NO_COLOR === undefined;

/**
 * Format a log message with timestamp, level, and tag
 */
function formatMessage(level: LogLevel, tag: string, message: string): string {
  const timestamp = new Date().toISOString();
  const { label, color } = levelLabels[level];

  if (useColors) {
    return `${colors.dim}[${timestamp}]${colors.reset} ${color}[${label}]${colors.reset} ${colors.cyan}[${tag}]${colors.reset} ${message}`;
  }

  return `[${timestamp}] [${label}] [${tag}] ${message}`;
}

/**
 * Log a message if it meets the current log level
 */
function log(level: LogLevel, tag: string, message: string, error?: unknown): void {
  if (level < currentLevel) return;

  const formattedMessage = formatMessage(level, tag, message);

  switch (level) {
    case LogLevel.DEBUG:
    case LogLevel.INFO:
      console.log(formattedMessage);
      break;
    case LogLevel.WARN:
      console.warn(formattedMessage);
      break;
    case LogLevel.ERROR:
      console.error(formattedMessage);
      if (error) {
        if (error instanceof Error) {
          console.error(error.stack ?? error.message);
        } else {
          console.error(error);
        }
      }
      break;
  }
}

/**
 * Create a scoped logger with a fixed tag
 */
export function createLogger(tag: string) {
  return {
    debug: (message: string) => {
      log(LogLevel.DEBUG, tag, message);
    },
    info: (message: string) => {
      log(LogLevel.INFO, tag, message);
    },
    warn: (message: string, error?: unknown) => {
      log(LogLevel.WARN, tag, message, error);
    },
    error: (message: string, error?: unknown) => {
      log(LogLevel.ERROR, tag, message, error);
    },
  };
}

/**
 * Global logger instance for general use
 */
export const logger = {
  debug: (tag: string, message: string) => {
    log(LogLevel.DEBUG, tag, message);
  },
  info: (tag: string, message: string) => {
    log(LogLevel.INFO, tag, message);
  },
  warn: (tag: string, message: string, error?: unknown) => {
    log(LogLevel.WARN, tag, message, error);
  },
  error: (tag: string, message: string, error?: unknown) => {
    log(LogLevel.ERROR, tag, message, error);
  },
};

export default logger;
