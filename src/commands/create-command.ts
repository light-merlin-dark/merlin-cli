import type {
  Command,
  CommandSpec,
  CommandContext
} from '../types/index.ts';
import { validateOptions } from './middleware/validate-options.ts';
import { validateArgs } from './middleware/validate-args.ts';
import { logExecution } from './middleware/log-execution.ts';

/**
 * Marks a command that declared its arguments or options.
 *
 * Only such a command gets strict parsing — an undeclared option is a usage
 * error rather than a silently accepted typo. A command that declared nothing
 * never opted in, so it keeps 1.x's permissive parsing untouched.
 */
export const DECLARED = Symbol.for('@light-merlin-dark/merlin-cli.declared');

export function declaresSurface(command: Command | null | undefined): boolean {
  if (!command) return false;
  const marked = (command as unknown as Record<symbol, unknown>)[DECLARED];
  if (typeof marked === 'boolean') return marked;
  // Hand-written command objects (no `createCommand`) are judged on content.
  return Object.keys(command.options ?? {}).length > 0 || Object.keys(command.args ?? {}).length > 0;
}

export function createCommand<T>(spec: CommandSpec<T>): Command<T> {
  const subcommands = spec.subcommands
    ? Object.fromEntries(
        Object.entries(spec.subcommands).map(([name, sub]) => [name, createCommand(sub)])
      )
    : undefined;

  const command: Command<T> = {
    name: spec.name,
    description: spec.description,
    usage: spec.usage || spec.name,
    examples: spec.examples || [],
    options: spec.options || {},
    args: spec.args || {},
    aliases: spec.aliases || [],
    ...(spec.exitCodes ? { exitCodes: spec.exitCodes } : {}),
    ...(spec.render ? { render: spec.render as (data: any) => string } : {}),
    ...(spec.hidden ? { hidden: true } : {}),
    ...(subcommands ? { subcommands } : {}),

    async execute(context: CommandContext): Promise<T> {
      const middleware = [
        ...(spec.middleware || []),
        validateArgs,
        validateOptions,
        logExecution
      ];

      let index = 0;
      const self = this;

      const next = async (): Promise<void> => {
        if (index < middleware.length) {
          const current = middleware[index++];
          await current(context, self, next);
        }
      };

      await next();

      if (!spec.execute) {
        throw new Error(`Command '${spec.name}' has no execute function`);
      }
      return spec.execute(context);
    }
  };

  Object.defineProperty(command, DECLARED, {
    value: spec.options !== undefined || spec.args !== undefined,
    enumerable: false
  });

  return command;
}
