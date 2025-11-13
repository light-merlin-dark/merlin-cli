import { LoggerToken, ConfigToken, PrompterToken, createRegistry } from './registry.ts';
import { bootstrap } from './bootstrap.ts';
import type { 
  CLIConfig, 
  CommandDefinition, 
  RouteContext,
  ServiceRegistry,
  Middleware
} from '../types/index.ts';
import { CommandRouter } from '../commands/router.ts';
import { createLogger } from '../services/logger.ts';
import { createPrompter } from '../services/prompter.ts';
import { createHelpCommand } from '../commands/universal/help.ts';
import { createVersionCommand } from '../commands/universal/version.ts';
import { PluginIntegration } from '../plugins/integration.ts';

export interface CLI {
  name: string;
  run(args?: string[]): Promise<void>;
  registry: ServiceRegistry;
  router: CommandRouter;
  commands: Record<string, CommandDefinition>;
  bootstrap?: (registry: ServiceRegistry) => Promise<void>;
  registerCommand(name: string, command: CommandDefinition): void;
  useMiddleware(middleware: Middleware): void;
  plugins?: PluginIntegration;
}

export function createCLI(config: CLIConfig): CLI {
  const registry = config.registry || createRegistry();

  // Register core services using tokens
  registry.register(ConfigToken, {
    name: config.name,
    version: config.version,
    description: config.description
  });

  registry.register(LoggerToken, createLogger({
    verbose: process.argv.includes('--verbose'),
    colors: process.stdout.isTTY
  }));

  registry.register(PrompterToken, createPrompter());

  // Create command router with universal commands
  const commands: Record<string, CommandDefinition> = {
    help: createHelpCommand({
      name: config.name,
      commands: config.commands || {},
      options: config.helpOptions
    }),
    version: createVersionCommand({
      version: config.version,
      name: config.name
    }),
    ...(config.commands || {})
  };

  const router = new CommandRouter(commands, registry, {
    onBeforeRoute: config.onBeforeRoute,
    onAfterRoute: config.onAfterRoute,
    onError: config.onError
  }, {
    customRouter: config.customRouter,
    defaultCommand: config.defaultCommand,
    defaultHandler: config.defaultHandler,
    beforeExecute: config.beforeExecute
  });

  // Apply middleware from config
  if (config.middleware) {
    for (const middleware of config.middleware) {
      router.use(middleware);
    }
  }

  const cli: CLI = {
    name: config.name,
    
    async run(args: string[] = process.argv.slice(2)): Promise<void> {
      try {
        await bootstrap({ registry });

        // Run custom bootstrap if provided
        if (cli.bootstrap) {
          await cli.bootstrap(registry);
        }

        // Initialize plugins if enabled
        if (config.plugins?.enabled !== false && cli.plugins) {
          await cli.plugins.initialize();
        }

        // Extract command name for plugin hooks
        const commandName = args[0] || 'help';
        
        // Run plugin beforeCommand hooks
        if (cli.plugins) {
          await cli.plugins.runBeforeCommandHooks(commandName);
        }

        await router.route(args);

        // Run plugin afterCommand hooks
        if (cli.plugins) {
          await cli.plugins.runAfterCommandHooks(commandName);
        }

        // Allow event loop to complete before exiting
        // This ensures all async I/O operations (console.log, etc.) complete
        await new Promise(resolve => setImmediate(resolve));
      } catch (error) {
        const logger = registry.get(LoggerToken);
        logger.error(`Fatal error: ${error}`);

        // Allow error logging to complete before exit
        await new Promise(resolve => setImmediate(resolve));
        process.exit(1);
      }
    },

    registerCommand(name: string, command: CommandDefinition): void {
      commands[name] = command;
      // Update help command with new commands
      commands.help = createHelpCommand({
        name: config.name,
        commands,
        options: config.helpOptions
      });
    },

    useMiddleware(middleware: Middleware): void {
      router.use(middleware);
    },

    registry,
    router,
    commands
  };

  // Create plugin integration if plugins are enabled
  if (config.plugins?.enabled !== false) {
    cli.plugins = new PluginIntegration(cli, registry, config.plugins || {});
  }

  return cli;
}