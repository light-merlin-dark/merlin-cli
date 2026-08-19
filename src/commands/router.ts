import { LoggerToken } from '../core/registry.ts';
import { UsageError } from '../core/errors.ts';
import { bindArgs, parseArgv, parseLegacy, type ParseResult } from '../core/grammar.ts';
import { describe, resolveCommand } from './lazy.ts';
import { declaresSurface } from './create-command.ts';
import type {
  Command,
  CommandDefinition,
  CommandContext,
  RouteContext,
  ServiceRegistry,
  Middleware,
  CustomRouterResult
} from '../types/index.ts';

export interface RoutingOptions {
  customRouter?: (args: string[]) => CustomRouterResult | null;
  defaultCommand?: string;
  defaultHandler?: (context: { args: string[]; options: Record<string, any> }) => Promise<unknown> | unknown;
  beforeExecute?: (context: { command: string; args: string[]; options: Record<string, any> }) => { command: string; args: string[]; options: Record<string, any> } | null;
  /** Reject undeclared options on commands that declare a surface. */
  strictOptions?: 'on' | 'off';
  /** Extra context the CLI supplies to every command. */
  contextExtras?: () => Partial<CommandContext>;
  /**
   * Called once the invocation is understood and before anything executes, so
   * the caller can settle the output format against the command's own
   * declarations. `null` when no command matched.
   */
  onResolved?: (resolution: Resolution | null) => void;
}

/** What the router worked out before running anything. */
export interface Resolution {
  /** Declaration for the command, still unloaded if it is lazy. */
  definition: CommandDefinition | null;
  /** Metadata available without loading. `null` for a 1.x opaque thunk. */
  metadata: Command | null;
  /** Command path as the user reached it, e.g. `['dns', 'add']`. */
  path: string[];
  /** Tokens left after the command path. */
  tokens: string[];
  /** True when the invocation asked for help rather than execution. */
  wantsHelp: boolean;
  /** Set when no command matched and a default handler will take the args. */
  useDefaultHandler: boolean;
}

export interface RouteOutcome {
  result: unknown;
  /** The command path that actually ran, for the envelope's `command` field. */
  command: string;
  /** Text-mode renderer declared by the command that ran, if any. */
  render?: (data: unknown) => string;
}

const HELP_FLAGS = new Set(['--help', '-h']);
const VERSION_FLAGS = new Set(['--version', '-V']);

export class CommandRouter {
  private middleware: Middleware[] = [];

  constructor(
    private commands: Record<string, CommandDefinition>,
    private registry: ServiceRegistry,
    private hooks?: {
      onBeforeRoute?: (context: RouteContext) => Promise<void>;
      onAfterRoute?: (context: RouteContext) => Promise<void>;
      onError?: (error: Error, context: RouteContext) => Promise<void>;
    },
    private routingOptions?: RoutingOptions
  ) {}

  use(middleware: Middleware): void {
    this.middleware.push(middleware);
  }

  /**
   * Work out what the invocation refers to, loading nothing.
   *
   * This runs before execution so the framework can settle the output format
   * against the command's own declarations — a command that owns `--json`
   * keeps it — and so `--help` never executes anything.
   */
  resolve(args: string[]): Resolution {
    const tokensAll = [...args];
    let head = tokensAll[0];

    // A bare `--help` / `--version` before any command name. 1.x reported these
    // as unknown commands, which is the first thing a person tries.
    if (head !== undefined && HELP_FLAGS.has(head)) {
      return this.entry('help', tokensAll.slice(1), true);
    }
    if (head !== undefined && VERSION_FLAGS.has(head)) {
      return this.entry('version', tokensAll.slice(1), false);
    }

    if (head === undefined || head.startsWith('-')) {
      if (this.routingOptions?.defaultCommand && this.commands[this.routingOptions.defaultCommand]) {
        return this.entry(this.routingOptions.defaultCommand, tokensAll, false);
      }
      if (head !== undefined && this.routingOptions?.defaultHandler) {
        return {
          definition: null,
          metadata: null,
          path: [],
          tokens: tokensAll,
          wantsHelp: false,
          useDefaultHandler: true
        };
      }
      return this.entry('help', head === undefined ? [] : tokensAll, false);
    }

    let definition = this.commands[head] ?? this.findByAlias(head);
    let path = [head];
    let tokens = tokensAll.slice(1);

    if (!definition) {
      if (this.routingOptions?.defaultCommand && this.commands[this.routingOptions.defaultCommand]) {
        return this.entry(this.routingOptions.defaultCommand, tokensAll, false);
      }
      if (this.routingOptions?.defaultHandler) {
        return {
          definition: null,
          metadata: null,
          path: [],
          tokens: tokensAll,
          wantsHelp: false,
          useDefaultHandler: true
        };
      }
      throw new UsageError(
        `Unknown command: ${head}. Run 'help' to see the available commands.`
      );
    }

    // Longest declared subcommand path wins. Metadata is read, never loaded.
    let metadata = describe(definition);
    while (metadata?.subcommands && tokens.length > 0 && !tokens[0].startsWith('-')) {
      const next = tokens[0];
      const sub =
        metadata.subcommands[next] ??
        Object.values(metadata.subcommands).find(candidate => candidate.aliases?.includes(next));

      if (!sub) {
        if (!metadata.execute) {
          throw new UsageError(
            `Unknown subcommand '${next}' for '${path.join(' ')}'. Available: ${Object.keys(metadata.subcommands).join(', ')}`
          );
        }
        break;
      }

      definition = sub;
      metadata = sub;
      path.push(next);
      tokens = tokens.slice(1);
    }

    const wantsHelp = tokens.some(token => HELP_FLAGS.has(token));

    return { definition, metadata, path, tokens, wantsHelp, useDefaultHandler: false };
  }

  private entry(name: string, tokens: string[], wantsHelp: boolean): Resolution {
    const definition = this.commands[name] ?? null;
    return {
      definition,
      metadata: definition ? describe(definition) : null,
      path: [name],
      tokens,
      wantsHelp,
      useDefaultHandler: false
    };
  }

  /** Parse a resolved invocation's tokens against the command's declarations. */
  parse(resolution: Resolution, command: Command | null): ParseResult {
    const strict =
      this.routingOptions?.strictOptions !== 'off' && declaresSurface(command ?? resolution.metadata);

    if (!strict && !declaresSurface(command ?? resolution.metadata)) {
      return parseLegacy(resolution.tokens);
    }

    return parseArgv(resolution.tokens, {
      options: (command ?? resolution.metadata)?.options ?? {},
      args: (command ?? resolution.metadata)?.args ?? {},
      strict
    });
  }

  /**
   * Route and execute. Returns whatever the command returned so the caller can
   * derive an exit code from it — discarding it is what made returned failures
   * exit 0.
   */
  async route(args: string[]): Promise<unknown> {
    return (await this.routeDetailed(args)).result;
  }

  async routeDetailed(args: string[]): Promise<RouteOutcome> {
    const [commandName = 'help', ...restArgs] = args;
    const context: RouteContext = {
      commandName,
      args: restArgs,
      options: parseLegacy(restArgs).options
    };

    try {
      if (this.hooks?.onBeforeRoute) {
        await this.hooks.onBeforeRoute(context);
      }

      if (this.routingOptions?.customRouter) {
        const custom = this.routingOptions.customRouter(args);
        const definition = custom ? this.commands[custom.command] : undefined;

        if (custom && definition) {
          const resolution: Resolution = {
            definition,
            metadata: describe(definition),
            path: [custom.command],
            tokens: custom.args,
            wantsHelp: false,
            useDefaultHandler: false
          };
          this.routingOptions.onResolved?.(resolution);
          const outcome = await this.executeResolved(resolution, context);
          await this.hooks?.onAfterRoute?.(context);
          return outcome;
        }
      }

      const resolution = this.resolve(args);
      this.routingOptions?.onResolved?.(resolution);
      const outcome = await this.executeResolved(resolution, context);

      if (this.hooks?.onAfterRoute) {
        await this.hooks.onAfterRoute(context);
      }

      return outcome;
    } catch (error) {
      if (this.hooks?.onError) {
        await this.hooks.onError(error as Error, context);

        // The hook consumed the error, but the command still failed. Report a
        // failure result so the caller cannot exit 0 on a handled error.
        return { result: { success: false, error: error as Error }, command: context.commandName };
      }
      throw error;
    }
  }

  /** Execute an already-resolved invocation. */
  async executeResolved(resolution: Resolution, context: RouteContext): Promise<RouteOutcome> {
    if (resolution.useDefaultHandler) {
      const result = await this.routingOptions!.defaultHandler!({
        args: resolution.tokens,
        options: parseLegacy(resolution.tokens).options
      });
      return { result, command: resolution.path.join(' ') || '(default)' };
    }

    if (resolution.wantsHelp) {
      return this.runHelpFor(resolution.path);
    }

    let command = await resolveCommand(resolution.definition!);

    // A parent that groups subcommands and has nothing to run itself: show its
    // help rather than failing, which is what 1.x did and what a person expects
    // from `mycli dns` with no verb.
    if (command.subcommands && !command.execute) {
      return this.runHelpFor(resolution.path);
    }

    const parsed = this.parse(resolution, command);

    if (parsed.warnings.length > 0) {
      const logger = this.registry.get(LoggerToken);
      for (const warning of parsed.warnings) logger.warn(warning);
    }

    const declaredArgs = command.args ?? {};

    let commandContext: CommandContext = {
      args: parsed.positionals,
      options: parsed.options,
      registry: this.registry,
      argv: parsed.passthrough,
      ...(Object.keys(declaredArgs).length > 0
        ? { namedArgs: bindArgs(parsed.positionals, declaredArgs) }
        : {}),
      ...this.routingOptions?.contextExtras?.()
    };

    if (this.routingOptions?.beforeExecute) {
      const transformed = this.routingOptions.beforeExecute({
        command: resolution.path[resolution.path.length - 1] ?? '',
        args: commandContext.args,
        options: commandContext.options
      });

      if (transformed) {
        commandContext = { ...commandContext, args: transformed.args, options: transformed.options };
      }
    }

    const result = await this.runMiddleware(command, commandContext, resolution.path);

    return {
      result,
      command: resolution.path.join(' '),
      render: command.render as ((data: unknown) => string) | undefined
    };
  }

  private async runHelpFor(path: string[]): Promise<RouteOutcome> {
    const helpDefinition = this.commands.help;
    if (!helpDefinition) {
      throw new UsageError(`No help available for '${path.join(' ')}'.`);
    }

    const help = await resolveCommand(helpDefinition);
    const args = path[0] === 'help' ? [] : path;

    const result = await help.execute!({
      args,
      options: {},
      registry: this.registry,
      ...this.routingOptions?.contextExtras?.()
    });

    return { result, command: 'help', render: help.render as ((data: unknown) => string) | undefined };
  }

  /**
   * Apply the middleware chain.
   *
   * The command's return value is captured in a closure rather than read off
   * `next()`. Middleware is publicly typed `next: () => Promise<void>` and does
   * not forward what the command returned, so widening that signature would
   * break every existing middleware's types for no gain.
   */
  private async runMiddleware(
    command: Command,
    context: CommandContext,
    path: string[]
  ): Promise<unknown> {
    let index = 0;
    let commandResult: unknown;

    const next = async (): Promise<void> => {
      if (index < this.middleware.length) {
        const current = this.middleware[index++];
        await current(context, command, next);
      } else {
        if (!command.execute) {
          throw new UsageError(`Command '${path.join(' ')}' requires a subcommand`);
        }
        commandResult = await command.execute(context);
      }
    };

    await next();

    return commandResult;
  }

  private findByAlias(alias: string): CommandDefinition | undefined {
    for (const definition of Object.values(this.commands)) {
      const metadata = describe(definition);
      if (metadata?.aliases?.includes(alias)) return definition;
    }
    return undefined;
  }
}
