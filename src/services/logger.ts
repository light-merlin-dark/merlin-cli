import pc from 'picocolors';
import type { Logger, LogLevel, LoggerConfig } from '../types/index.ts';

export { type Logger };

/**
 * Where a logger records that it reported an error.
 *
 * A symbol, and not a named method, because `Logger` is a public interface that
 * consumers implement themselves. Adding a required member would break every
 * one of those; a symbol is invisible to structural typing, so a hand-rolled
 * logger still satisfies `Logger` and simply opts out of the check.
 */
export const ERROR_COUNT = Symbol.for('@merlin/cli.errorCount');

/** Read how many errors a logger has reported, if it is keeping count. */
export function errorCountOf(logger: unknown): number | null {
  const count = (logger as Record<symbol, unknown> | null)?.[ERROR_COUNT];
  return typeof count === 'number' ? count : null;
}

/**
 * Give any logger the error counting the exit-code policy depends on.
 *
 * Consumers routinely register their own logger under `LoggerToken` — often
 * via their own `createToken('logger')`, which collides on the same registry
 * key and replaces ours outright. Four repos in the estate do exactly that.
 * Without this wrapper the strict policy reads `errorCountOf() === null`,
 * treats it as zero, and silently never fires: a fail-open sitting inside the
 * fix built to close a fail-open.
 *
 * A Proxy rather than a copy, so the consumer's own methods, properties and
 * `this` binding survive untouched — we only intercept the two entry points
 * that can report an error.
 */
export function withErrorCounting<T extends object>(logger: T): T {
  // Already counting (ours, or wrapped once already) — wrapping twice would
  // double-count nothing useful.
  if (errorCountOf(logger) !== null) return logger;

  let errorCount = 0;

  return new Proxy(logger, {
    get(target, prop, receiver) {
      if (prop === ERROR_COUNT) return errorCount;

      const value = Reflect.get(target, prop, receiver);

      if (prop === 'error' && typeof value === 'function') {
        return (...args: unknown[]) => {
          errorCount++;
          return value.apply(target, args);
        };
      }

      // `log(level, message)` is the other door into an error report.
      if (prop === 'log' && typeof value === 'function') {
        return (...args: unknown[]) => {
          if (args[0] === 'error') errorCount++;
          return value.apply(target, args);
        };
      }

      return value;
    },

    has(target, prop) {
      return prop === ERROR_COUNT || Reflect.has(target, prop);
    }
  });
}

export function createLogger(config: LoggerConfig = {}): Logger {
  const colorize = config.colors !== false && pc.isColorSupported;
  let errorCount = 0;

  const log = (level: LogLevel, message: string) => {
    // Counted before the silence check on purpose: a silenced error is still
    // an error the command reported. Suppressing the output must not also
    // suppress the failure.
    if (level === 'error') errorCount++;

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
    log,
    get [ERROR_COUNT]() {
      return errorCount;
    }
  } as Logger;
}