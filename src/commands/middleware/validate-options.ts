import type { CommandContext, Command, CommandDefinition, Middleware, OptionSpec } from '../../types/index.ts';

export const validateOptions: Middleware = async (context, command, next) => {
  const { options: providedOptions } = context;
  
  // Skip validation for lazy-loaded commands or commands without options
  if (typeof command === 'function') {
    await next();
    return;
  }
  
  const cmd = command as Command;
  const optionSpecs = cmd.options || {};

  const errors: string[] = [];

  // Check required options
  for (const [name, optionSpec] of Object.entries(optionSpecs)) {
    const spec = optionSpec as OptionSpec;
    if (spec.required && !(name in providedOptions)) {
      errors.push(`Missing required option: --${name}`);
    }
  }

  // Validate provided options
  for (const [name, value] of Object.entries(providedOptions)) {
    const optionSpec = optionSpecs[name] as OptionSpec | undefined;
    
    if (!optionSpec) {
      // Allow unspecified options (could be handled by command)
      continue;
    }

    // Type validation
    switch (optionSpec.type) {
      case 'number':
        if (typeof value !== 'number' && isNaN(Number(value))) {
          errors.push(`Option --${name} must be a number`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          errors.push(`Option --${name} must be a boolean`);
        }
        break;
      case 'array':
        if (!Array.isArray(value) && typeof value === 'string') {
          // Convert comma-separated string to array
          context.options[name] = value.split(',').map(v => v.trim());
        }
        break;
    }

    // Custom validation
    if (optionSpec.validate) {
      const result = optionSpec.validate(value);
      if (typeof result === 'string') {
        errors.push(result);
      } else if (!result) {
        errors.push(`Invalid value for option --${name}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Validation errors:\n${errors.join('\n')}`);
  }

  // Apply defaults
  for (const [name, optionSpec] of Object.entries(optionSpecs)) {
    const spec = optionSpec as OptionSpec;
    if (!(name in providedOptions) && 'default' in spec) {
      context.options[name] = spec.default;
    }
  }

  // Convert types
  for (const [name, value] of Object.entries(context.options)) {
    const optionSpec = optionSpecs[name] as OptionSpec | undefined;
    if (!optionSpec) continue;

    switch (optionSpec.type) {
      case 'number':
        context.options[name] = Number(value);
        break;
      case 'boolean':
        context.options[name] = value === true || value === 'true';
        break;
    }
  }

  // Call next middleware or command
  await next();
};