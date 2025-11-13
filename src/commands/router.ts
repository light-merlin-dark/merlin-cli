import { LoggerToken } from '../core/registry.ts';
import type { 
  CommandDefinition, 
  CommandContext,
  RouteContext,
  ServiceRegistry,
  Middleware,
  CustomRouterResult
} from '../types/index.ts';

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
    private routingOptions?: {
      customRouter?: (args: string[]) => CustomRouterResult | null;
      defaultCommand?: string;
      defaultHandler?: (context: { args: string[]; options: Record<string, any> }) => Promise<void> | void;
      beforeExecute?: (context: { command: string; args: string[]; options: Record<string, any> }) => { command: string; args: string[]; options: Record<string, any> } | null;
    }
  ) {}

  use(middleware: Middleware): void {
    this.middleware.push(middleware);
  }

  async route(args: string[]): Promise<void> {
    let [commandName = 'help', ...restArgs] = args;
    let context: RouteContext = {
      commandName,
      args: restArgs,
      options: this.parseOptions(restArgs)
    };

    try {
      // Before route hook
      if (this.hooks?.onBeforeRoute) {
        await this.hooks.onBeforeRoute(context);
      }

      // Try custom router first
      if (this.routingOptions?.customRouter) {
        const customResult = this.routingOptions.customRouter(args);
        if (customResult) {
          commandName = customResult.command;
          restArgs = customResult.args;
          context = {
            commandName,
            args: restArgs,
            options: this.parseOptions(restArgs)
          };
          
          if (customResult.skipNormalRouting) {
            // Use custom routing result directly
            const commandDef = this.commands[commandName];
            if (commandDef) {
              await this.executeCommand(commandDef, commandName, restArgs, context);
              return;
            }
          }
        }
      }

      // Resolve command (handle lazy loading)
      let commandDef = this.commands[commandName];
      let subcommandPath: string[] = [commandName];
      let remainingArgs = restArgs;

      if (!commandDef) {
        // Check aliases
        const aliasedCommand = this.findByAlias(commandName);
        if (aliasedCommand) {
          commandDef = aliasedCommand;
        } else {
          // Try default command or handler
          if (this.routingOptions?.defaultCommand) {
            const defaultCommandDef = this.commands[this.routingOptions.defaultCommand];
            if (defaultCommandDef) {
              commandDef = defaultCommandDef;
              commandName = this.routingOptions.defaultCommand;
              restArgs = args; // Use original args for default command
              remainingArgs = args;
              subcommandPath = [this.routingOptions.defaultCommand];
            } else {
              throw new Error(`Default command '${this.routingOptions.defaultCommand}' not found`);
            }
          } else if (this.routingOptions?.defaultHandler) {
            // Execute default handler directly
            await this.routingOptions.defaultHandler({
              args: args,
              options: this.parseOptions(args)
            });
            
            // After route hook
            if (this.hooks?.onAfterRoute) {
              await this.hooks.onAfterRoute(context);
            }
            return;
          } else {
            throw new Error(`Unknown command: ${commandName}`);
          }
        }
      }

      // If it's a lazy-loaded command, resolve it
      if (typeof commandDef === 'function') {
        const startTime = performance.now();
        commandDef = await commandDef();
        const loadTime = performance.now() - startTime;

        const logger = this.registry.get(LoggerToken);
        logger.debug(`Loaded command '${commandName}' in ${loadTime.toFixed(1)}ms`);
      }

      // Check for subcommands
      if (commandDef.subcommands && remainingArgs.length > 0) {
        const potentialSubcommand = remainingArgs[0];
        
        // Don't treat options as subcommands
        if (!potentialSubcommand.startsWith('-')) {
          const subcommand = commandDef.subcommands[potentialSubcommand];
          
          if (subcommand) {
            commandDef = subcommand;
            subcommandPath.push(potentialSubcommand);
            remainingArgs = remainingArgs.slice(1);
          } else if (!commandDef.execute) {
            // If parent command has no execute and invalid subcommand
            throw new Error(`Unknown subcommand '${potentialSubcommand}' for command '${commandName}'. Available subcommands: ${Object.keys(commandDef.subcommands).join(', ')}`);
          }
        }
      }

      // If command has subcommands but no execute function and no subcommand was provided
      if (commandDef.subcommands && !commandDef.execute && remainingArgs.filter(arg => !arg.startsWith('-')).length === 0) {
        // Show help for the command
        const helpCommand = this.commands.help || this.commands.Help;
        if (helpCommand) {
          const helpContext: CommandContext = {
            args: [commandName],
            options: {},
            registry: this.registry
          };
          
          if (typeof helpCommand === 'function') {
            const resolvedHelp = await helpCommand();
            if (resolvedHelp.execute) {
              await resolvedHelp.execute(helpContext);
            }
          } else {
            if (helpCommand.execute) {
              await helpCommand.execute(helpContext);
            }
          }
          return;
        }
      }

      await this.executeCommand(commandDef, commandName, remainingArgs, context, subcommandPath);

      // After route hook
      if (this.hooks?.onAfterRoute) {
        await this.hooks.onAfterRoute(context);
      }
    } catch (error) {
      // Error hook
      if (this.hooks?.onError) {
        await this.hooks.onError(error as Error, context);
      } else {
        throw error;
      }
    }
  }

  private parseOptions(args: string[]): Record<string, any> {
    const options: Record<string, any> = {};

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg.startsWith('--')) {
        const [key, value] = arg.slice(2).split('=');
        if (value !== undefined) {
          options[key] = value;
        } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          options[key] = args[++i];
        } else {
          options[key] = true;
        }
      } else if (arg.startsWith('-') && arg.length === 2) {
        const key = arg.slice(1);
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          options[key] = args[++i];
        } else {
          options[key] = true;
        }
      }
    }

    return options;
  }

  private findByAlias(alias: string): CommandDefinition | undefined {
    for (const [, commandDef] of Object.entries(this.commands)) {
      // For lazy-loaded commands, we can't check aliases without loading
      if (typeof commandDef === 'function') {
        continue;
      }
      
      if (commandDef.aliases?.includes(alias)) {
        return commandDef;
      }
    }
    return undefined;
  }

  private async executeCommand(
    commandDef: CommandDefinition,
    commandName: string,
    remainingArgs: string[],
    context: RouteContext,
    subcommandPath: string[] = [commandName]
  ): Promise<void> {
    // Resolve lazy-loaded command if needed
    let resolvedCommand = commandDef;
    if (typeof resolvedCommand === 'function') {
      resolvedCommand = await resolvedCommand();
    }

    // Execute command with middleware
    let commandContext: CommandContext = {
      args: remainingArgs.filter(arg => !arg.startsWith('-')),
      options: context.options,
      registry: this.registry
    };

    // Apply beforeExecute hook if provided
    if (this.routingOptions?.beforeExecute) {
      const transformed = this.routingOptions.beforeExecute({
        command: commandName,
        args: commandContext.args,
        options: commandContext.options
      });
      
      if (transformed) {
        commandContext = {
          args: transformed.args,
          options: transformed.options,
          registry: this.registry
        };
      }
    }

    // Apply middleware chain
    const executeWithMiddleware = async () => {
      let index = 0;
      
      const next = async (): Promise<void> => {
        if (index < this.middleware.length) {
          const currentMiddleware = this.middleware[index++];
          await currentMiddleware(commandContext, resolvedCommand, next);
        } else {
          if (!resolvedCommand.execute) {
            throw new Error(`Command '${subcommandPath.join(' ')}' requires a subcommand`);
          }
          await resolvedCommand.execute(commandContext);
        }
      };
      
      await next();
    };

    await executeWithMiddleware();
  }
}