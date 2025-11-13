import type { CommandContext, Command, CommandDefinition, Middleware, ArgSpec } from '../../types/index.ts';

export const validateArgs: Middleware = async (context, command, next) => {
  const { args: providedArgs } = context;
  
  // Skip validation for lazy-loaded commands or commands without args
  if (typeof command === 'function') {
    await next();
    return;
  }
  
  const cmd = command as Command;
  const argSpecs = cmd.args || {};

  const errors: string[] = [];
  const argNames = Object.keys(argSpecs);
  const namedArgs: Record<string, any> = {};

  // Check required args
  for (let i = 0; i < argNames.length; i++) {
    const argName = argNames[i];
    const argSpec = argSpecs[argName] as ArgSpec;
    
    if (argSpec.required && !providedArgs[i]) {
      errors.push(`Missing required argument: ${argName}`);
      continue;
    }
    
    if (providedArgs[i] !== undefined) {
      let value: any = providedArgs[i];
      
      // Type validation and conversion
      switch (argSpec.type) {
        case 'number':
          if (isNaN(Number(value))) {
            errors.push(`Argument ${argName} must be a number`);
          } else {
            value = Number(value);
          }
          break;
        case 'string':
          // Already a string, no conversion needed
          break;
      }

      // Custom validation
      if (argSpec.validate) {
        const result = argSpec.validate(value);
        if (typeof result === 'string') {
          errors.push(result);
        } else if (!result) {
          errors.push(`Invalid value for argument ${argName}`);
        }
      }
      
      namedArgs[argName] = value;
    }
  }

  if (errors.length > 0) {
    throw new Error(`Validation errors:\n${errors.join('\n')}`);
  }

  // Add named args to context
  context.namedArgs = namedArgs;

  // Call next middleware or command
  await next();
};