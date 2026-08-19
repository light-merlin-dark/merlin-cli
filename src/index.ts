// Core exports
export { ServiceRegistry, createRegistry } from './core/registry.ts';
export { bootstrap, type BootstrapConfig } from './core/bootstrap.ts';
export { createCLI, type CLI } from './core/cli.ts';
export {
  resolveExitCode,
  isFailureResult,
  GENERIC_FAILURE_EXIT_CODE,
  type CommandResult
} from './core/exit-code.ts';
export {
  UsageError,
  isUsageError,
  exitCodeOfError,
  normalizeExitCode,
  USAGE_EXIT_CODE
} from './core/errors.ts';

// Output: formats, the envelope, and the payload extraction rule
export {
  extractData,
  CONTRACT_VERSION,
  type Envelope,
  type EnvelopeError,
  type OutputFormat
} from './core/output.ts';

// The argument grammar, and the manifest built from declarations
export { parseArgv, parseLegacy, bindArgs, RESERVED_OPTIONS, type ParseResult } from './core/grammar.ts';
export {
  buildManifest,
  manifestSubtree,
  MANIFEST_SCHEMA,
  RESERVED_COMMANDS,
  type Manifest,
  type ManifestCommand,
  type ManifestArg,
  type ManifestOption
} from './core/manifest.ts';

// Command system exports
export {
  createCommand,
  CommandRouter,
  lazy,
  type Command,
  type CommandSpec,
  type CommandContext,
  type CommandExecutor,
  type LazyCommand,
  type OptionSpec,
  type ArgSpec
} from './commands/index.ts';

// Middleware, for callers composing their own chains
export { validateOptions } from './commands/middleware/validate-options.ts';
export { validateArgs } from './commands/middleware/validate-args.ts';
export { logExecution } from './commands/middleware/log-execution.ts';

// Universal commands
export { createHelpCommand } from './commands/universal/help.ts';
export { createVersionCommand } from './commands/universal/version.ts';
export { createManifestCommand } from './commands/universal/manifest.ts';

// Services
export { createLogger, errorCountOf, ERROR_COUNT, instrumentLogger, type Logger } from './services/logger.ts';
export { createPrompter, type Prompter, type PromptOptions, type PrompterOptions } from './services/prompter.ts';

// Service tokens
export { LoggerToken, ConfigToken, PrompterToken, createToken } from './core/registry.ts';

// Utilities
export * from './utils/index.ts';

// Types
export * from './types/index.ts';

// Testing utilities
export * from './testing/index.ts';
