import { env } from '../config/env';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function log(level: LogLevel, message: string, meta?: object): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta && { meta }),
  };

  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else if (env.NODE_ENV !== 'test') {
    console.log(JSON.stringify(entry));
  }
}

export const logger = {
  info: (message: string, meta?: object) => log('info', message, meta),
  warn: (message: string, meta?: object) => log('warn', message, meta),
  error: (message: string, meta?: object) => log('error', message, meta),
  debug: (message: string, meta?: object) => {
    if (env.NODE_ENV === 'development') log('debug', message, meta);
  },
};
