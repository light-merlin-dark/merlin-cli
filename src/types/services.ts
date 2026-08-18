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
   * Only applies to loggers created by this framework. A consumer-supplied
   * `Logger` keeps no count, so it silently falls back to `'off'`.
   */
  errorExitPolicy?: 'strict' | 'off';
  // Plugin configuration
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