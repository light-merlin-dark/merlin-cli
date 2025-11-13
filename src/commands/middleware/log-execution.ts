import { LoggerToken } from '../../core/registry.ts';
import type { CommandContext, CommandDefinition, Middleware } from '../../types/index.ts';

export const logExecution: Middleware = async (context, command, next) => {
  const logger = context.registry.get(LoggerToken);
  
  // Log before execution
  const commandName = typeof command === 'function' ? 'lazy-loaded' : command.name;
  logger.debug(`Executing command: ${commandName}`);
  logger.debug(`Args: ${JSON.stringify(context.args)}`);
  logger.debug(`Options: ${JSON.stringify(context.options)}`);
  
  // Call next middleware or command
  await next();
};