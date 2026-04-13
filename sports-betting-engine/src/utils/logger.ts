// ============================================================
// src/utils/logger.ts
// Centralized logger -- respects LOG_LEVEL env var
// ============================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
  return LEVELS[env] !== undefined ? env : 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[getConfiguredLevel()];
}

function timestamp(): string {
  return new Date().toISOString();
}

function format(level: string, message: string, data?: unknown): string {
  const prefix = `[${timestamp()}] [${level.toUpperCase()}]`;
  if (data !== undefined) {
    const extra = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
    return `${prefix} ${message}\n${extra}`;
  }
  return `${prefix} ${message}`;
}

export const logger = {
  debug(message: string, data?: unknown): void {
    if (shouldLog('debug')) console.debug(format('debug', message, data));
  },
  info(message: string, data?: unknown): void {
    if (shouldLog('info')) console.info(format('info', message, data));
  },
  warn(message: string, data?: unknown): void {
    if (shouldLog('warn')) console.warn(format('warn', message, data));
  },
  error(message: string, data?: unknown): void {
    if (shouldLog('error')) console.error(format('error', message, data));
  },
  section(title: string): void {
    if (shouldLog('info')) {
      console.info('\n' + '='.repeat(60));
      console.info(`  ${title}`);
      console.info('='.repeat(60));
    }
  },
  divider(): void {
    if (shouldLog('info')) console.info('-'.repeat(60));
  },
};
