export { createCommand, declaresSurface } from './create-command.ts';
export { lazy, isLazy, describe, resolveCommand } from './lazy.ts';
export { CommandRouter } from './router.ts';
export { createHelpCommand } from './universal/help.ts';
export { createVersionCommand } from './universal/version.ts';
export { createManifestCommand } from './universal/manifest.ts';

// Export middleware
export { validateOptions } from './middleware/validate-options.ts';
export { logExecution } from './middleware/log-execution.ts';

// Re-export types
export type {
  Command,
  ArgSpec,
  LazyCommand,
  CommandSpec,
  CommandContext,
  CommandExecutor,
  OptionSpec,
  CommandDefinition,
  RouteContext,
  Middleware
} from '../types/index.ts';