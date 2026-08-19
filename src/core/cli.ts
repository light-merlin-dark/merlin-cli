import { LoggerToken, ConfigToken, PrompterToken, createRegistry } from './registry.ts';
import { bootstrap } from './bootstrap.ts';
import { resolveExitCode } from './exit-code.ts';
import { GENERIC_FAILURE_EXIT_CODE, exitCodeOfError, messageOfError } from './errors.ts';
import { Output, setOutput, currentOutput } from './output.ts';
import { installSignalHandling } from './signals.ts';
import type {
  CLIConfig,
  CommandDefinition,
  ServiceRegistry,
  Middleware,
  CommandContext
} from '../types/index.ts';
import { CommandRouter, type Resolution, type RouteOutcome } from '../commands/router.ts';
import { createLogger, errorCountOf, instrumentLogger } from '../services/logger.ts';
import { createPrompter } from '../services/prompter.ts';
import { createHelpCommand } from '../commands/universal/help.ts';
import { createVersionCommand } from '../commands/universal/version.ts';
import { createManifestCommand } from '../commands/universal/manifest.ts';

/** Marks a registry whose logger registrations are already intercepted. */
const COUNTING_INSTALLED = Symbol.for('@light-merlin-dark/merlin-cli.loggerCountingInstalled');

/**
 * Patch a registry so every logger registered under `LoggerToken` is
 * instrumented — including ones registered long after `createCLI` returns,
 * which is the normal case.
 *
 * Idempotent: a registry passed to two CLIs is patched once.
 */
function installLoggerInstrumentation(registry: ServiceRegistry): void {
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
        ? instrumentLogger(service as object)
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
          return service && typeof service === 'object' ? instrumentLogger(service as object) : service;
        }
      : factory;
    return (registerFactory as (t: unknown, f: () => unknown) => void)(tokenOrName, wrapped);
  };
}

export interface CLI {
  name: string;
  /**
   * Execute a command. Resolves with the process exit code it derived from the
   * command's outcome. When `config.exitProcess` is not `false`, the process
   * also leaves with that code once its streams have flushed.
   */
  run(args?: string[]): Promise<number>;
  registry: ServiceRegistry;
  router: CommandRouter;
  commands: Record<string, CommandDefinition>;
  bootstrap?: (registry: ServiceRegistry) => Promise<void>;
  registerCommand(name: string, command: CommandDefinition): void;
  useMiddleware(middleware: Middleware): void;
}

/**
 * Yield one macrotask, so writes queued on a pipe get their turn.
 *
 * `setImmediate` is a Node invention and is absent from Deno's default global
 * scope; `setTimeout(…, 0)` is the portable equivalent and exists everywhere
 * this framework claims to run.
 */
function nextTick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function flush(stream: NodeJS.WriteStream | undefined): Promise<void> {
  if (!stream || typeof stream.write !== 'function') return;
  if (!('writableLength' in stream) || stream.writableLength === 0) return;
  await new Promise<void>(resolve => {
    stream.write('', () => resolve());
  });
}

export function createCLI(config: CLIConfig): CLI {
  const registry = config.registry || createRegistry();

  // Any logger that lands under `LoggerToken` gets instrumented, no matter who
  // registers it or when.
  //
  // Consumers overwhelmingly bring their own logger, and typically register it
  // from `cli.bootstrap` — i.e. after this function has returned, on a key that
  // collides with ours. Counting only the logger we construct here would mean
  // the exit-code guarantee quietly evaporates for most real CLIs while still
  // reporting itself as active.
  installLoggerInstrumentation(registry);

  registry.register(ConfigToken, {
    name: config.name,
    version: config.version,
    description: config.description
  });

  registry.register(LoggerToken, createLogger({
    verbose: process.argv.includes('--verbose'),
    stream: config.streams?.stderr
  }));

  registry.register(PrompterToken, createPrompter());

  // The CLI's own commands come first, so help and the manifest list them
  // before the reserved three. A CLI that defines its own `help`, `version` or
  // `manifest` keeps it — the framework only fills what is missing.
  const commands: Record<string, CommandDefinition> = { ...(config.commands || {}) };
  const ownsHelp = 'help' in commands;
  const ownsVersion = 'version' in commands;
  const ownsManifest = 'manifest' in commands;

  if (!ownsVersion) {
    commands.version = createVersionCommand({ version: config.version, name: config.name });
  }

  /**
   * Help and the manifest describe the command set, so they are rebuilt
   * whenever it changes. Both read `commands` live, which is what keeps
   * `registerCommand` visible to them.
   */
  const refreshReserved = (): void => {
    if (!ownsHelp) {
      commands.help = createHelpCommand({
        name: config.name,
        version: config.version,
        description: config.description,
        commands,
        options: config.helpOptions
      });
    }
    if (!ownsManifest) {
      commands.manifest = createManifestCommand({
        name: config.name,
        version: config.version,
        description: config.description,
        commands
      });
    }
  };
  refreshReserved();

  let context: { signal?: AbortSignal; output?: Output } = {};

  const router = new CommandRouter(commands, registry, {
    onBeforeRoute: config.onBeforeRoute,
    onAfterRoute: config.onAfterRoute,
    onError: config.onError
  }, {
    customRouter: config.customRouter,
    defaultCommand: config.defaultCommand,
    defaultHandler: config.defaultHandler,
    beforeExecute: config.beforeExecute,
    strictOptions: config.strictOptions,
    onResolved: (resolution: Resolution | null) => {
      context.output?.settle({
        json: Boolean(resolution?.metadata?.options && 'json' in resolution.metadata.options),
        ndjson: Boolean(resolution?.metadata?.options && 'ndjson' in resolution.metadata.options)
      });
    },
    contextExtras: (): Partial<CommandContext> => ({
      signal: context.signal,
      format: context.output?.format,
      emit: (item: unknown) => context.output?.emit(item)
    })
  });

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

      const output = new Output({
        name: config.name,
        version: config.version,
        argv: args,
        stdout: config.streams?.stdout,
        stderr: config.streams?.stderr
      });
      context.output = output;
      setOutput(output);

      const signals = installSignalHandling({
        gracePeriodMs: config.gracePeriodMs,
        onTerminate: code => {
          // Even a death gets an envelope, so a stream consumer learns the
          // truth about it rather than seeing the pipe simply stop.
          try {
            output.finish({ code, command: 'interrupted', result: undefined, error: new Error('Interrupted') });
          } catch {
            output.abandon();
          }
        },
        exit: shouldExitProcess ? undefined : () => undefined
      });
      context.signal = signals.signal;

      // Sampled before the command runs, not assumed to be zero: `run()` may be
      // called more than once on the same CLI, and bootstrap can log too.
      const errorsBefore = errorCountOf(registry.get(LoggerToken)) ?? 0;

      let outcome: RouteOutcome | null = null;
      let exitCode = 0;
      let thrown: unknown;

      try {
        await bootstrap({ registry });
        if (cli.bootstrap) await cli.bootstrap(registry);

        outcome = await router.routeDetailed(args);

        // A command that returns `{ success: false }` (or an explicit exitCode)
        // has failed. Honour that: discarding it is what let failed commands
        // print an error and still exit 0.
        exitCode = resolveExitCode(outcome.result);

        // The other half of the same defect. Reading only the return value is
        // blind to `logger.error(...); return;` — a shape that reports failure
        // to the human and success to the shell. If the command told the user
        // it failed, it failed; the return value does not get to overrule that.
        if (exitCode === 0 && strictErrors) {
          const errorsAfter = errorCountOf(registry.get(LoggerToken)) ?? 0;
          if (errorsAfter > errorsBefore) exitCode = GENERIC_FAILURE_EXIT_CODE;
        }
      } catch (error) {
        thrown = error;
        exitCode = exitCodeOfError(error);
        output.settle();
        registry.get(LoggerToken).error(messageOfError(error));
      }

      // An interrupted command did not succeed, whatever its cleanup returned.
      // Without this, a handler that catches the abort and resolves normally
      // reports exit 0 for a run the caller killed.
      if (signals.interruptedWith !== null) exitCode = signals.interruptedWith;

      output.settle();

      try {
        output.finish({
          code: exitCode,
          command: outcome?.command ?? (args[0] ?? 'help'),
          result: thrown === undefined ? outcome?.result : undefined,
          error: thrown,
          render: outcome?.render
        });
      } finally {
        signals.dispose();
        setOutput(null);
        context = {};
      }

      await flush(process.stdout);
      await flush(process.stderr);
      await nextTick();

      // A finished CLI terminates. A stray `setInterval` in application code
      // must not keep a process alive after its command has produced a result.
      if (shouldExitProcess) process.exit(exitCode);

      return exitCode;
    },

    registerCommand(name: string, command: CommandDefinition): void {
      commands[name] = command;
      refreshReserved();
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

export { currentOutput };
