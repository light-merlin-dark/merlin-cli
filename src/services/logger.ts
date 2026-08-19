import type { Logger, LogLevel, LoggerConfig } from '../types/index.ts';
import { createStyler } from '../utils/colors.ts';
import { currentOutput, type EventLevel } from '../core/output.ts';

export { type Logger };

/**
 * Where a logger records that it reported an error.
 *
 * A symbol, and not a named method, because `Logger` is a public interface that
 * consumers implement themselves. Adding a required member would break every
 * one of those; a symbol is invisible to structural typing, so a hand-rolled
 * logger still satisfies `Logger` and simply opts out of the check.
 */
export const ERROR_COUNT = Symbol.for('@light-merlin-dark/merlin-cli.errorCount');

/** Read how many errors a logger has reported, if it is keeping count. */
export function errorCountOf(logger: unknown): number | null {
  const count = (logger as Record<symbol, unknown> | null)?.[ERROR_COUNT];
  return typeof count === 'number' ? count : null;
}

const LEVELS: readonly EventLevel[] = ['info', 'error', 'warn', 'debug', 'success'];

/**
 * Give any logger the two things the framework needs from it: an error count,
 * and a way for the output plane to take its events.
 *
 * Consumers routinely register their own logger under `LoggerToken` — often via
 * their own `createToken('logger')`, which collides on the same registry key and
 * replaces ours outright. Without this wrapper the strict exit policy reads
 * `errorCountOf() === null`, treats it as zero, and silently never fires.
 *
 * The plane's second job matters just as much: in machine mode it consumes the
 * event and re-renders it as NDJSON on stderr, so a consumer logger that prints
 * to stdout with `console.log` cannot corrupt the JSON document a caller is
 * parsing.
 *
 * A Proxy rather than a copy, so the consumer's own methods, properties and
 * `this` binding survive untouched.
 */
export function instrumentLogger<T extends object>(logger: T): T {
  if (errorCountOf(logger) !== null) return logger;

  let errorCount = 0;

  return new Proxy(logger, {
    get(target, prop, receiver) {
      if (prop === ERROR_COUNT) return errorCount;

      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;

      if (LEVELS.includes(prop as EventLevel)) {
        const level = prop as EventLevel;
        return (...args: unknown[]) => {
          // Counted before anything can suppress it: a silenced error is still
          // an error the command reported.
          if (level === 'error') errorCount++;
          if (currentOutput()?.event(level, String(args[0] ?? ''))) return undefined;
          return value.apply(target, args);
        };
      }

      // `log(level, message)` is the other door into an error report.
      if (prop === 'log') {
        return (...args: unknown[]) => {
          const level = args[0] as EventLevel;
          if (level === 'error') errorCount++;
          if (LEVELS.includes(level) && currentOutput()?.event(level, String(args[1] ?? ''))) {
            return undefined;
          }
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

/** @deprecated Use `instrumentLogger`. Kept because 1.x imported this name. */
export const withErrorCounting = instrumentLogger;

/**
 * The framework's logger. Everything it says is commentary, so everything it
 * says goes to stderr — including `info` and `success`, which 1.x sent to
 * stdout and which therefore ended up inside anything that piped a CLI.
 */
export function createLogger(config: LoggerConfig = {}): Logger {
  let errorCount = 0;
  const stream = config.stream ?? process.stderr;
  const palette = createStyler(config.stream ? {} : process.stderr);

  const log = (level: LogLevel, message: string) => {
    if (level === 'error') errorCount++;

    if (currentOutput()?.event(level as EventLevel, message)) return;

    if (config.silent) return;
    if (level === 'debug' && !config.verbose) return;

    const prefix = config.prefix ? `[${config.prefix}] ` : '';
    let output = `${prefix}[${level.toUpperCase()}] ${message}`;

    if (config.colors !== false) {
      switch (level) {
        case 'info': output = palette.blue(output); break;
        case 'error': output = palette.red(output); break;
        case 'warn': output = palette.yellow(output); break;
        case 'debug': output = palette.gray(output); break;
        case 'success': output = palette.green(output); break;
      }
    }

    stream.write(output + '\n');
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
