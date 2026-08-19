/**
 * The argument grammar, written down.
 *
 * 1.x parsed flags with a loop that guessed: `--name` took the next token as a
 * value unless it started with `-`, unknown options were accepted silently, and
 * option values were also counted as positionals. That is fine until a typo
 * (`--forse`) quietly skips the confirmation flag it was meant to set.
 *
 * This implements the GNU/POSIX subset that won, and nothing else:
 *
 *   --                 ends option parsing; the rest is positional, verbatim
 *   --name=value       sets a declared option
 *   --name value       sets a declared value-taking option
 *   --name             sets a declared boolean true
 *   --no-name          sets a declared boolean false
 *   -abc               bundles declared boolean shorts a, b, c
 *   -o value / -ovalue binds a declared value-taking short
 *   -2, -0.5           positional when no such short option is declared
 *
 * Options and positionals may interleave; order among positionals is preserved.
 *
 * Commands that declare neither args nor options keep 1.x's permissive parsing
 * exactly (`parseLegacy`). Strictness is earned by declaring, never imposed on
 * a command that never opted in.
 */

import { UsageError } from './errors.ts';
import type { ArgSpec, OptionSpec } from '../types/commands.ts';

/**
 * Long option names the framework answers on every command, so that passing
 * them is never a usage error. They are not stripped from the parsed options:
 * a 1.x command reading `options.json` itself keeps seeing it.
 */
export const RESERVED_OPTIONS = ['json', 'ndjson', 'verbose', 'quiet', 'help'] as const;

export interface ParseSpec {
  options: Record<string, OptionSpec>;
  args: Record<string, ArgSpec>;
  /** Reject undeclared options (GRAM-4). Off for commands that declare nothing. */
  strict: boolean;
}

export interface ParseResult {
  /** Positional tokens, in order, option values excluded. */
  positionals: string[];
  /** Parsed and coerced options, including reserved ones the caller passed. */
  options: Record<string, unknown>;
  /** Tokens after `--`, verbatim. */
  passthrough: string[];
  /** Non-fatal notes, e.g. a repeated non-array option. */
  warnings: string[];
}

const isReserved = (name: string): boolean =>
  (RESERVED_OPTIONS as readonly string[]).includes(name);

/** A token that is a negative number rather than a short option. */
const isNumericToken = (token: string): boolean =>
  /^-\d/.test(token) && Number.isFinite(Number(token));

function shortIndex(options: Record<string, OptionSpec>): Map<string, string> {
  const index = new Map<string, string>();
  for (const [name, spec] of Object.entries(options)) {
    if (spec.alias) index.set(spec.alias, name);
  }
  return index;
}

function takesValue(spec: OptionSpec | undefined): boolean {
  return spec !== undefined && spec.type !== 'boolean';
}

/**
 * 1.x parsing, preserved byte-for-byte in behaviour for commands that declare
 * nothing. Positionals are every token that does not start with `-`, which
 * means an option's value also appears as a positional — a quirk some commands
 * were written against.
 */
export function parseLegacy(tokens: string[]): ParseResult {
  const options: Record<string, unknown> = {};

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.startsWith('--')) {
      const [key, value] = token.slice(2).split('=');
      if (value !== undefined) {
        options[key] = value;
      } else if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
        options[key] = tokens[++i];
      } else {
        options[key] = true;
      }
    } else if (token.startsWith('-') && token.length === 2) {
      const key = token.slice(1);
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
        options[key] = tokens[++i];
      } else {
        options[key] = true;
      }
    }
  }

  const separator = tokens.indexOf('--');

  return {
    positionals: tokens.filter(token => !token.startsWith('-')),
    options,
    passthrough: separator === -1 ? [] : tokens.slice(separator + 1),
    warnings: []
  };
}

/**
 * Parse a declared command's tokens.
 *
 * Stages run in a fixed, total order — parse, coerce, defaults, required,
 * choices, custom validators — and the first failing stage throws a
 * `UsageError` naming the offending token and the expected form.
 */
export function parseArgv(tokens: string[], spec: ParseSpec): ParseResult {
  const shorts = shortIndex(spec.options);
  const positionals: string[] = [];
  const passthrough: string[] = [];
  const warnings: string[] = [];
  const raw = new Map<string, unknown[]>();

  const record = (name: string, value: unknown): void => {
    const existing = raw.get(name);
    if (existing) existing.push(value);
    else raw.set(name, [value]);
  };

  const declaredOrReserved = (name: string): OptionSpec | undefined => {
    const declared = spec.options[name];
    if (declared) return declared;
    if (isReserved(name)) return { type: 'boolean', description: '' };
    if (spec.strict) {
      throw new UsageError(
        `Unknown option: --${name}. Run with --help to see the options this command accepts.`
      );
    }
    return undefined;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === '--') {
      const rest = tokens.slice(i + 1);
      passthrough.push(...rest);
      positionals.push(...rest);
      break;
    }

    if (token.startsWith('--')) {
      const body = token.slice(2);
      const equals = body.indexOf('=');

      if (equals !== -1) {
        const name = body.slice(0, equals);
        declaredOrReserved(name);
        record(name, body.slice(equals + 1));
        continue;
      }

      if (body.startsWith('no-')) {
        const name = body.slice(3);
        const negated = spec.options[name];
        if (negated?.type === 'boolean') {
          record(name, false);
          continue;
        }
        // Not a declared boolean, so `--no-x` is just an option called `no-x`.
        declaredOrReserved(body);
        record(body, true);
        continue;
      }

      const declared = declaredOrReserved(body);

      if (takesValue(declared)) {
        const next = tokens[i + 1];
        if (next === undefined || (next.startsWith('-') && next !== '-' && !isNumericToken(next))) {
          throw new UsageError(`Option --${body} expects a ${declared!.type} value.`);
        }
        record(body, tokens[++i]);
        continue;
      }

      if (declared) {
        record(body, true);
        continue;
      }

      // Undeclared and not strict: keep 1.x's guess.
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith('-')) record(body, tokens[++i]);
      else record(body, true);
      continue;
    }

    if (token.startsWith('-') && token.length > 1 && !isNumericToken(token)) {
      const body = token.slice(1);
      const firstName = shorts.get(body[0]);
      const firstSpec = firstName ? spec.options[firstName] : undefined;

      // -ovalue / -o value for a declared value-taking short.
      if (firstSpec && takesValue(firstSpec)) {
        if (body.length > 1) {
          record(firstName!, body.slice(1));
        } else {
          const next = tokens[i + 1];
          if (next === undefined || (next.startsWith('-') && next !== '-' && !isNumericToken(next))) {
            throw new UsageError(`Option -${body} expects a ${firstSpec.type} value.`);
          }
          record(firstName!, tokens[++i]);
        }
        continue;
      }

      if (firstSpec || !spec.strict) {
        // Bundle: every character must be a declared boolean short, or (when
        // not strict) is recorded as its own flag the way 1.x did.
        let bundled = true;
        for (const char of body) {
          const name = shorts.get(char);
          const charSpec = name ? spec.options[name] : undefined;
          if (charSpec && charSpec.type === 'boolean') continue;
          bundled = false;
          break;
        }

        if (bundled) {
          for (const char of body) record(shorts.get(char)!, true);
          continue;
        }

        if (!spec.strict) {
          if (body.length === 1) {
            const next = tokens[i + 1];
            if (next !== undefined && !next.startsWith('-')) record(body, tokens[++i]);
            else record(body, true);
          } else {
            record(body, true);
          }
          continue;
        }
      }

      throw new UsageError(
        `Unknown option: -${body}. Run with --help to see the options this command accepts.`
      );
    }

    positionals.push(token);
  }

  const options = coerce(raw, spec, warnings);

  return { positionals, options, passthrough, warnings };
}

function coerceScalar(name: string, value: unknown, spec: OptionSpec): unknown {
  switch (spec.type) {
    case 'number': {
      if (typeof value === 'number') return value;
      const parsed = Number(value);
      if (typeof value === 'boolean' || value === '' || !Number.isFinite(parsed)) {
        throw new UsageError(`Option --${name} must be a number, got '${String(value)}'.`);
      }
      return parsed;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new UsageError(`Option --${name} is a flag; it does not take the value '${String(value)}'.`);
    default:
      return value;
  }
}

function coerce(
  raw: Map<string, unknown[]>,
  spec: ParseSpec,
  warnings: string[]
): Record<string, unknown> {
  const options: Record<string, unknown> = {};

  for (const [name, values] of raw) {
    const declared = spec.options[name];

    if (!declared) {
      // Reserved or (non-strict) undeclared: last wins, uncoerced.
      options[name] = values[values.length - 1];
      continue;
    }

    if (declared.type === 'array') {
      // `split: false` keeps each value whole. A repeated option carrying free
      // text — a reason, a message, a description — is one value a person
      // wrote, and splitting it on commas produces fragments that often still
      // look well-formed, so the failure is silent rather than loud.
      options[name] =
        declared.split === false
          ? [...values]
          : values.flatMap(value =>
              typeof value === 'string' ? value.split(',').map(part => part.trim()) : [value]
            );
      continue;
    }

    if (values.length > 1) {
      warnings.push(`Option --${name} was given more than once; using the last value.`);
    }

    options[name] = coerceScalar(name, values[values.length - 1], declared);
  }

  // Defaults and environment fallbacks, in declaration order.
  for (const [name, declared] of Object.entries(spec.options)) {
    if (name in options) continue;

    if (declared.env && process.env[declared.env] !== undefined) {
      const fromEnv = process.env[declared.env] as string;
      options[name] =
        declared.type === 'array'
          ? declared.split === false
            ? [fromEnv]
            : fromEnv.split(',').map(part => part.trim())
          : coerceScalar(name, fromEnv, declared);
      continue;
    }

    if ('default' in declared && declared.default !== undefined) {
      options[name] = declared.default;
    }
  }

  // Required, then choices, then custom validators.
  for (const [name, declared] of Object.entries(spec.options)) {
    if (declared.required && !(name in options)) {
      throw new UsageError(`Missing required option: --${name}`);
    }
  }

  for (const [name, declared] of Object.entries(spec.options)) {
    if (!(name in options) || !declared.choices) continue;
    const given = Array.isArray(options[name]) ? (options[name] as unknown[]) : [options[name]];
    for (const value of given) {
      if (!declared.choices.includes(value as never)) {
        throw new UsageError(
          `Option --${name} must be one of: ${declared.choices.join(', ')}. Got '${String(value)}'.`
        );
      }
    }
  }

  for (const [name, declared] of Object.entries(spec.options)) {
    if (!(name in options) || !declared.validate) continue;
    const verdict = declared.validate(options[name]);
    if (typeof verdict === 'string') throw new UsageError(verdict);
    if (!verdict) throw new UsageError(`Invalid value for option --${name}`);
  }

  return options;
}

/**
 * Bind positional tokens to declared argument names, coercing and validating
 * each. Extra positionals are left in `positionals` for the command to read.
 */
export function bindArgs(
  positionals: string[],
  args: Record<string, ArgSpec>
): Record<string, unknown> {
  const named: Record<string, unknown> = {};
  const names = Object.keys(args);

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const spec = args[name];
    const token = positionals[i];

    if (token === undefined) {
      if (spec.required) {
        throw new UsageError(`Missing required argument: <${name}> — ${spec.description}`);
      }
      if ('default' in spec && (spec as { default?: unknown }).default !== undefined) {
        named[name] = (spec as { default?: unknown }).default;
      }
      continue;
    }

    let value: unknown = token;

    if (spec.type === 'number') {
      const parsed = Number(token);
      if (!Number.isFinite(parsed)) {
        throw new UsageError(`Argument <${name}> must be a number, got '${token}'.`);
      }
      value = parsed;
    }

    if (spec.choices && !spec.choices.includes(value as never)) {
      throw new UsageError(
        `Argument <${name}> must be one of: ${spec.choices.join(', ')}. Got '${token}'.`
      );
    }

    if (spec.validate) {
      const verdict = spec.validate(value);
      if (typeof verdict === 'string') throw new UsageError(verdict);
      if (!verdict) throw new UsageError(`Invalid value for argument <${name}>`);
    }

    named[name] = value;
  }

  return named;
}
