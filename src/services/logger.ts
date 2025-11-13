import pc from 'picocolors';
import type { Logger, LogLevel, LoggerConfig } from '../types/index.ts';

export { type Logger };

export function createLogger(config: LoggerConfig = {}): Logger {
  const colorize = config.colors !== false && pc.isColorSupported;

  const log = (level: LogLevel, message: string) => {
    if (config.silent) return;
    if (level === 'debug' && !config.verbose) return;

    const prefix = config.prefix ? `[${config.prefix}] ` : '';
    const levelPrefix = `[${level.toUpperCase()}]`;

    let output = `${prefix}${levelPrefix} ${message}`;

    if (colorize) {
      switch (level) {
        case 'info':
          output = pc.blue(output);
          break;
        case 'error':
          output = pc.red(output);
          break;
        case 'warn':
          output = pc.yellow(output);
          break;
        case 'debug':
          output = pc.gray(output);
          break;
        case 'success':
          output = pc.green(output);
          break;
      }
    }

    if (level === 'error') {
      console.error(output);
    } else {
      console.log(output);
    }
  };

  return {
    info: (msg) => log('info', msg),
    error: (msg) => log('error', msg),
    warn: (msg) => log('warn', msg),
    debug: (msg) => log('debug', msg),
    success: (msg) => log('success', msg),
    log
  };
}