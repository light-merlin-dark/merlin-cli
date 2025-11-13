import type { 
  Command, 
  CommandSpec, 
  CommandContext,
  Middleware 
} from '../types/index.ts';
import { validateOptions } from './middleware/validate-options.ts';
import { validateArgs } from './middleware/validate-args.ts';
import { logExecution } from './middleware/log-execution.ts';

export function createCommand<T>(spec: CommandSpec<T>): Command<T> {
  // Validate examples for AI optimization (only in debug mode)
  if (process.env.DEBUG === 'true' && (!spec.examples || spec.examples.length < 2)) {
    console.warn(
      `Command ${spec.name} should have at least 2 diverse examples for AI agents`
    );
  }

  return {
    name: spec.name,
    description: spec.description,
    usage: spec.usage || spec.name,
    examples: spec.examples || [],
    options: spec.options || {},
    args: spec.args || {},
    aliases: spec.aliases || [],

    async execute(context: CommandContext): Promise<T> {
      // Apply middleware
      const middleware = [
        ...(spec.middleware || []),
        validateArgs,
        validateOptions,
        logExecution
      ];

      // Create middleware chain
      let index = 0;
      const command = this; // Reference to the command object
      
      const executeWithMiddleware = async (): Promise<T> => {
        const next = async (): Promise<void> => {
          if (index < middleware.length) {
            const currentMiddleware = middleware[index++];
            await currentMiddleware(context, command, next);
          }
        };
        
        // Start middleware chain
        await next();
        
        // Execute command after all middleware
        if (!spec.execute) {
          throw new Error(`Command '${spec.name}' has no execute function`);
        }
        return spec.execute(context);
      };

      return executeWithMiddleware();
    }
  };
}