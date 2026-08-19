import type { ServiceRegistry } from '../core/registry.ts';
import type { OutputFormat } from '../core/output.ts';

export interface CommandContext {
  /**
   * Positional tokens, in order. Still a `string[]`, as in 1.x — every command
   * in the estate reads it that way and typed positionals arrive by name on
   * `namedArgs` instead.
   */
  args: string[];
  /** Positionals bound to declared `args` names, coerced to their types. */
  namedArgs?: Record<string, any>;
  /** Parsed and coerced options. */
  options: Record<string, any>;
  registry: ServiceRegistry;
  /** Tokens after `--`, verbatim. */
  argv?: string[];
  /** Aborted on SIGINT/SIGTERM, giving the command its chance to clean up. */
  signal?: AbortSignal;
  /** What the caller asked to see. Rarely needed: the renderer decides. */
  format?: OutputFormat;
  /** Stream one payload item. One NDJSON line, or one rendered text line. */
  emit?: (item: unknown) => void;
}

export interface Command<T = any> {
  name: string;
  description: string;
  usage?: string;
  examples?: string[];
  options?: Record<string, OptionSpec>;
  args?: Record<string, ArgSpec>;
  aliases?: string[];
  subcommands?: Record<string, Command>;
  /** Exit codes this command may return, for the manifest and for help. */
  exitCodes?: Record<number, string>;
  /** Text-mode view of the returned data. Omit it and text mode prints nothing. */
  render?: (data: any) => string;
  /** Hidden from help and the manifest listing, still routable. */
  hidden?: boolean;
  execute?: (context: CommandContext) => Promise<T> | T;
}

export interface OptionSpec {
  type: 'string' | 'boolean' | 'number' | 'array';
  description: string;
  default?: any;
  required?: boolean;
  alias?: string;
  /** Accepted values. Anything else is a usage error. */
  choices?: readonly any[];
  /** Environment variable consulted when the option is absent. */
  env?: string;
  /**
   * For `array` options: split each value on commas. Default `true`.
   *
   * Set `false` when a repeated option carries FREE TEXT rather than a list.
   * `--deviation input="a new key, a new domain, and a deploy"` is one value a
   * person wrote, and splitting it produces three fragments — the first of which
   * still parses as a plausible `key=value`, so the failure is silent rather
   * than loud.
   *
   * Ignored for non-array options.
   */
  split?: boolean;
  validate?: (value: any) => boolean | string;
}

export interface ArgSpec {
  type: 'string' | 'number';
  description: string;
  required?: boolean;
  default?: any;
  choices?: readonly any[];
  validate?: (value: any) => boolean | string;
}

export interface CommandSpec<T = any> {
  name: string;
  description: string;
  usage?: string;
  examples?: string[];
  options?: Record<string, OptionSpec>;
  args?: Record<string, ArgSpec>;
  aliases?: string[];
  exitCodes?: Record<number, string>;
  hidden?: boolean;
  render?: (data: T) => string;
  middleware?: Middleware[];
  subcommands?: Record<string, CommandSpec>;
  execute?: CommandExecutor<T>;
}

export type CommandExecutor<T> = (context: CommandContext) => Promise<T> | T;

export type Middleware = (context: CommandContext, command: CommandDefinition, next: () => Promise<void>) => Promise<void>;

/**
 * A lazily loaded command that can still describe itself.
 *
 * The bare thunk form (`() => Promise<Command>`) is 1.x's and keeps working,
 * but help cannot describe it and aliases cannot find it without loading every
 * module. The described form carries its metadata inline, so a CLI with five
 * hundred commands starts, helps and manifests at the speed of one with five.
 */
export interface LazyCommand extends Command {
  readonly lazy: true;
  load: () => Promise<Command>;
}

/**
 * `LazyCommand` extends `Command` rather than sitting beside it in this union
 * on purpose: consumer code that narrows a definition with
 * `typeof def !== 'function'` and then reads `.execute` keeps compiling.
 */
export type CommandDefinition = Command | (() => Promise<Command>);

export interface RouteContext {
  commandName: string;
  args: string[];
  options: Record<string, any>;
}
