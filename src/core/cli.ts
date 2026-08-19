import { LoggerToken, ConfigToken, PrompterToken, createRegistry } from './registry.ts';
import { bootstrap } from './bootstrap.ts';
import { resolveExitCode, GENERIC_FAILURE_EXIT_CODE } from './exit-code.ts';
import type { 
  CLIConfig, 
  CommandDefinition, 
  RouteContext,
  ServiceRegistry,
  Middleware
} from '../types/index.ts';
import { CommandRouter } from '../commands/router.ts';
import { createLogger, errorCountOf, withErrorCounting } from '../services/logger.ts';
import { createPrompter } from '../services/prompter.ts';
import { createHelpCommand } from '../commands/universal/help.ts';
import { createVersionCommand } from '../commands/universal/version.ts';

/** Marks a registry whose logger registrations are already intercepted. */
const COUNTING_INSTALLED = Symbol.for('@light-merlin-dark/merlin-cli.loggerCountingInstalled');

/**
 * Patch a registry so every logger registered under `LoggerToken` is wrapped
 * with error counting — including ones registered long after `createCLI`
 * returns, which is the normal case.
 *
 * Idempotent: a registry passed to two CLIs is patched once.
 */
function installLoggerCounting(registry: ServiceRegistry): void {
  const target = registry as ServiceRegistry & Record<symbol, unknown>;
  if (target[COUNTING_INSTALLED]) return;
  target[COUNTING_INSTALLED] = true;

  const isLoggerKey = (tokenOrName: unknown): boolean =>
    (typeof tokenOrName === 'string' ? tokenOrName : (tokenOrName as { key?: string })?.key) ===
    LoggerToken.key;

  const register = registry.register.bind(registry);
  const registerFactory = registry.registerFactory.bind(registry);

  (registry as { register: (t: unknown, s: unknown) => void }).register = (tokenOrName, service) => {
    const wrapped =
      isLoggerKey(tokenOrName) && service && typeof service === 'object'
        ? withErrorCounting(service as object)
        : service;
    return (register as (t: unknown, s: unknown) => void)(tokenOrName, wrapped);
  };

  (registry as { registerFactory: (t: unknown, f: () => unknown) => void }).registerFactory = (
    tokenOrName,
    factory
  ) => {
    const wrapped = isLoggerKey(tokenOrName)
      ? () => {
          const service = factory();
          return service && typeof service === 'object' ? withErrorCounting(service as object) : service;
        }
      : factory;
    return (registerFactory as (t: unknown, f: () => unknown) => void)(tokenOrName, wrapped);
  };
}

export interface CLI {
  name: string;
  /**
   * Execute a command. Resolves with the process exit code it derived from the
   * command's return value: 0 for success, non-zero for a failure result. When
   * `config.exitProcess` is not `false` a non-zero code also calls
   * `process.exit()`, so the resolved value is only observable in that mode.
   */
  run(args?: string[]): Promise<number>;
  registry: ServiceRegistry;
  router: CommandRouter;
  commands: Record<string, CommandDefinition>;
  bootstrap?: (registry: ServiceRegistry) => Promise<void>;
  registerCommand(name: string, command: CommandDefinition): void;
  useMiddleware(middleware: Middleware): void;
}

export function createCLI(config: CLIConfig): CLI {
  const registry = config.registry || createRegistry();

  // Any logger that lands under `LoggerToken` gets error counting, no matter
  // who registers it or when.
  //
  // Consumers overwhelmingly bring their own logger, and typically register it
  // from `cli.bootstrap` — i.e. after this function has returned, on a key that
  // collides with ours. Counting only the logger we construct here would mean
  // the exit-code guarantee quietly evaporates for most real CLIs while still
  // reporting itself as active. Intercepting the registration is what makes
  // `errorExitPolicy` a property of the framework rather than of whether the
  // consumer happened to keep our logger.
  installLoggerCounting(registry);

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
    
    async run(args: string[] = process.argv.slice(2)): Promise<number> {
      const shouldExitProcess = config.exitProcess !== false;
      const strictErrors = config.errorExitPolicy !== 'off';

      // Sampled before the command runs, not assumed to be zero: `run()` may be
      // called more than once on the same CLI, and bootstrap can log too.
      const errorsBefore = errorCountOf(registry.get(LoggerToken)) ?? 0;

      try {
        await bootstrap({ registry });

        // Run custom bootstrap if provided
        if (cli.bootstrap) {
          await cli.bootstrap(registry);
        }

        const result = await router.route(args);

        // A command that returns `{ success: false }` (or an explicit
        // exitCode) has failed. Honour that: discarding it here is what let
        // failed commands print an error and still exit 0.
        let exitCode = resolveExitCode(result);

        // The other half of the same defect. Reading only the return value is
        // blind to `logger.error(...); return;` — a shape that reports failure
        // to the human and success to the shell. If the command told the user
        // it failed, it failed; the return value does not get to overrule that.
        if (exitCode === 0 && strictErrors) {
          const errorsAfter = errorCountOf(registry.get(LoggerToken)) ?? 0;
          if (errorsAfter > errorsBefore) {
            exitCode = GENERIC_FAILURE_EXIT_CODE;
          }
        }

        // Allow event loop to complete before exiting
        // This ensures all async I/O operations (console.log, etc.) complete
        await new Promise(resolve => setImmediate(resolve));

        if (exitCode !== 0 && shouldExitProcess) {
          process.exit(exitCode);
        }

        return exitCode;
      } catch (error) {
        const logger = registry.get(LoggerToken);
        logger.error(`Fatal error: ${error}`);

        // Allow error logging to complete before exit
        await new Promise(resolve => setImmediate(resolve));

        if (shouldExitProcess) {
          process.exit(1);
        }

        return 1;
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

  return cli;
}