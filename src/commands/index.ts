export { createCommand } from './create-command.ts';
export { CommandRouter } from './router.ts';
export { createHelpCommand } from './universal/help.ts';
export { createVersionCommand } from './universal/version.ts';

// Export middleware
export { validateOptions } from './middleware/validate-options.ts';
export { logExecution } from './middleware/log-execution.ts';

// Re-export types
export type {
  Command,
  CommandSpec,
  CommandContext,
  CommandExecutor,
  OptionSpec,
  CommandDefinition,
  RouteContext,
  Middleware
} from '../types/index.ts';