// Core exports
export { ServiceRegistry, createRegistry } from './core/registry.ts';
export { bootstrap, type BootstrapConfig } from './core/bootstrap.ts';
export { createCLI, type CLI } from './core/cli.ts';

// Command system exports
export {
  createCommand,
  CommandRouter,
  type Command,
  type CommandSpec,
  type CommandContext,
  type CommandExecutor,
  type OptionSpec
} from './commands/index.ts';

// Universal commands
export { createHelpCommand } from './commands/universal/help.ts';
export { createVersionCommand } from './commands/universal/version.ts';

// Services
export { createLogger, type Logger } from './services/logger.ts';
export { createPrompter, type Prompter } from './services/prompter.ts';

// Service tokens
export { LoggerToken, ConfigToken, PrompterToken, createToken } from './core/registry.ts';

// Utilities
export * from './utils/index.ts';

// Release automation
export { SmartRelease } from './release/smart-release.ts';
// export { ReleaseVerifier } from './release/verifier.ts';
// export { PostReleaseTester } from './release/post-release.ts';

// Types
export * from './types/index.ts';

// Testing utilities
export * from './testing/index.ts';

// Plugin system
export { 
  type Plugin, 
  type PluginManifest,
  type LoadedPlugin,
  PluginLoader,
  PluginIntegration 
} from './plugins/index.ts';