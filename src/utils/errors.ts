export class CLIError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'CLI_ERROR',
    public readonly exitCode: number = 1
  ) {
    super(message);
    this.name = 'CLIError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends CLIError {
  constructor(message: string, public readonly field?: string) {
    super(message, 'VALIDATION_ERROR', 1);
    this.name = 'ValidationError';
  }
}

export class ConfigError extends CLIError {
  constructor(message: string, public readonly configPath?: string) {
    super(message, 'CONFIG_ERROR', 1);
    this.name = 'ConfigError';
  }
}

export class CommandNotFoundError extends CLIError {
  constructor(command: string, public readonly availableCommands?: string[]) {
    super(`Command "${command}" not found`, 'COMMAND_NOT_FOUND', 1);
    this.name = 'CommandNotFoundError';
  }
}

export class ServiceNotFoundError extends CLIError {
  constructor(service: string) {
    super(`Service "${service}" not found in registry`, 'SERVICE_NOT_FOUND', 1);
    this.name = 'ServiceNotFoundError';
  }
}

export class NetworkError extends CLIError {
  constructor(message: string, public readonly url?: string) {
    super(message, 'NETWORK_ERROR', 2);
    this.name = 'NetworkError';
  }
}

export class FileSystemError extends CLIError {
  constructor(message: string, public readonly path?: string) {
    super(message, 'FS_ERROR', 3);
    this.name = 'FileSystemError';
  }
}

export class AuthenticationError extends CLIError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTH_ERROR', 4);
    this.name = 'AuthenticationError';
  }
}

export class PermissionError extends CLIError {
  constructor(message: string = 'Permission denied') {
    super(message, 'PERMISSION_ERROR', 5);
    this.name = 'PermissionError';
  }
}

export function isUserError(error: unknown): boolean {
  return error instanceof CLIError || 
         error instanceof ValidationError ||
         error instanceof CommandNotFoundError;
}

export function handleError(error: unknown, logger?: { error: (msg: string) => void }): never {
  const log = logger?.error || console.error;
  
  if (error instanceof CLIError) {
    log(error.message);
    
    if (error instanceof CommandNotFoundError && error.availableCommands?.length) {
      log('\nAvailable commands:');
      error.availableCommands.forEach(cmd => log(`  ${cmd}`));
    }
    
    if (error instanceof ValidationError && error.field) {
      log(`Field: ${error.field}`);
    }
    
    if (process.env.DEBUG === 'true' && error.stack) {
      log('\nStack trace:');
      log(error.stack);
    }
    
    process.exit(error.exitCode);
  }
  
  if (error instanceof Error) {
    log(`Unexpected error: ${error.message}`);
    if (process.env.DEBUG === 'true' && error.stack) {
      log('\nStack trace:');
      log(error.stack);
    }
    process.exit(1);
  }
  
  log(`Unknown error: ${String(error)}`);
  process.exit(1);
}

export function wrapAsync<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  errorHandler?: (error: unknown) => void
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (errorHandler) {
        errorHandler(error);
      } else {
        handleError(error);
      }
    }
  }) as T;
}

export function assertDefined<T>(
  value: T | null | undefined,
  message: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new ValidationError(message);
  }
}

export function assertType<T>(
  value: unknown,
  type: string,
  field?: string
): asserts value is T {
  const actualType = typeof value;
  if (actualType !== type) {
    throw new ValidationError(
      `Expected ${field ? `${field} to be` : ''} ${type}, got ${actualType}`,
      field
    );
  }
}