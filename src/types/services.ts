// Import types from commands to avoid circular dependencies
import type { CommandDefinition, Middleware, RouteContext } from './commands.ts';
import type { ServiceRegistry, Token } from '../core/registry.ts';

// Re-export Token for convenience
export type { Token } from '../core/registry.ts';

export interface LoggerConfig {
  verbose?: boolean;
  silent?: boolean;
  colors?: boolean;
  prefix?: string;
  /** Where commentary goes. Defaults to `process.stderr`. */
  stream?: { write(chunk: string): unknown };
}

export interface CustomRouterResult {
  command: string;
  args: string[];
  skipNormalRouting?: boolean;
}

export interface CLIConfig {
  name: string;
  version: string;
  description?: string;
  commands?: Record<string, CommandDefinition>;
  registry?: ServiceRegistry;
  middleware?: Middleware[];
  helpOptions?: HelpOptions;
  // Custom routing options
  customRouter?: (args: string[]) => CustomRouterResult | null;
  defaultCommand?: string;
  defaultHandler?: (context: { args: string[]; options: Record<string, any> }) => Promise<unknown> | unknown;
  beforeExecute?: (context: { command: string; args: string[]; options: Record<string, any> }) => { command: string; args: string[]; options: Record<string, any> } | null;
  /**
   * Call `process.exit()` when the command reports failure. Defaults to `true`.
   * Set `false` to have `run()` resolve with the exit code instead — used by
   * tests and by embedders that own their own process lifecycle.
   */
  exitProcess?: boolean;
  /**
   * How a command that reported an error through `logger.error()` is treated.
   *
   * - `'strict'` (default) — the command failed, whatever it returned. This
   *   closes the `logger.error(...); return;` shape, which reads as a handled
   *   failure but resolves to exit code 0. cf-cli alone had 16 of them.
   * - `'off'` — legacy behaviour; only the return value decides. For a CLI
   *   that genuinely reports non-fatal errors and means to continue.
   *
   * Applies to whatever logger is registered under `LoggerToken`, whoever
   * registers it and whenever — consumer loggers are wrapped transparently.
   */
  errorExitPolicy?: 'strict' | 'off';
  /**
   * Reject undeclared options on commands that declare their own args or
   * options. Defaults to `'on'`.
   *
   * A silently accepted `--forse` is how a deploy skips its confirmation flag.
   * Commands that declare nothing are unaffected either way: strictness is
   * earned by declaring, never imposed on a command that never opted in.
   */
  strictOptions?: 'on' | 'off';
  /**
   * How long a command has to clean up after SIGINT/SIGTERM before the process
   * leaves with 130/143. Defaults to 3000 ms.
   */
  gracePeriodMs?: number;
  /**
   * Where payload and commentary go. Defaults to the process's own streams;
   * overridden by the in-process test harness so a run can be observed without
   * spawning one.
   */
  streams?: {
    stdout?: { write(chunk: string): unknown };
    stderr?: { write(chunk: string): unknown };
  };
  /**
   * @deprecated Accepted and ignored. The plugin system was removed in 1.2.0 —
   * it was 313 lines that no consumer ever loaded a plugin through. The key
   * survives only because callers passing `plugins: { enabled: false }` should
   * not fail to compile over a feature they were already opting out of.
   */
  plugins?: {
    enabled?: boolean;
    autoLoad?: boolean;
    pluginPrefix?: string;
    searchPaths?: string[];
    allowLocal?: boolean;
  };
  // Hooks for extensibility
  onBeforeRoute?: (context: RouteContext) => Promise<void>;
  onAfterRoute?: (context: RouteContext) => Promise<void>;
  onError?: (error: Error, context: RouteContext) => Promise<void>;
}

export interface HelpOptions {
  showExamples?: boolean;
  aiOptimized?: boolean;
  format?: 'plain' | 'markdown' | 'json';
}

export interface BootstrapConfig {
  registry: ServiceRegistry;
}

export interface ReleaseResult {
  released: boolean;
  version: string;
}