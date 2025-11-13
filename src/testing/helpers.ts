import { createRegistry, LoggerToken, PrompterToken, type ServiceRegistry } from '../core/registry.ts';
import { createLogger, type Logger } from '../services/logger.ts';
import type { Prompter } from '../services/prompter.ts';
import type { Command, CommandContext, ServiceMap } from '../types/index.ts';

export interface MockPrompterOptions {
  responses?: Record<string, any>;
  confirmations?: Record<string, boolean>;
}

export function createMockPrompter(options?: MockPrompterOptions): Prompter {
  const responses = options?.responses || {};
  const confirmations = options?.confirmations || {};
  
  return {
    async confirm(message: string, initial?: boolean): Promise<boolean> {
      if (message in confirmations) {
        return confirmations[message];
      }
      return initial ?? true;
    },
    
    async text(message: string, initial?: string): Promise<string> {
      if (message in responses) {
        return String(responses[message]);
      }
      return initial || 'mock-response';
    },
    
    async select<T = string>(message: string, choices: Array<{ title: string; value: T }>): Promise<T> {
      if (message in responses) {
        const index = responses[message];
        return choices[index]?.value || choices[0]?.value;
      }
      return choices[0]?.value;
    },
    
    async multiselect<T = string>(message: string, choices: Array<{ title: string; value: T }>): Promise<T[]> {
      if (message in responses) {
        const indices = responses[message];
        return Array.isArray(indices) 
          ? indices.map(i => choices[i]?.value).filter((v): v is T => v !== undefined)
          : [choices[0]?.value].filter((v): v is T => v !== undefined);
      }
      return [choices[0]?.value].filter((v): v is T => v !== undefined);
    },
    
    async ask(questions: any): Promise<any> {
      return responses;
    }
  };
}

export interface MockLoggerOptions {
  silent?: boolean;
  captureOutput?: boolean;
}

export function createMockLogger(options?: MockLoggerOptions): Logger & { output: string[] } {
  const output: string[] = [];
  const silent = options?.silent ?? true;
  const capture = options?.captureOutput ?? true;
  
  const log = (level: string, message: string) => {
    if (capture) {
      output.push(`[${level}] ${message}`);
    }
    if (!silent) {
      console.log(`[${level}] ${message}`);
    }
  };
  
  return {
    output,
    log: (message: string) => log('LOG', message),
    info: (message: string) => log('INFO', message),
    warn: (message: string) => log('WARN', message),
    error: (message: string) => log('ERROR', message),
    debug: (message: string) => log('DEBUG', message),
    success: (message: string) => log('SUCCESS', message)
  };
}


export function mockRegistry(overrides?: Record<string, any>): ServiceRegistry {
  const registry = createRegistry();
  
  // Register mock services
  registry.register(LoggerToken, createLogger({ silent: true }));
  registry.register(PrompterToken, createMockPrompter());
  
  // Apply overrides
  Object.entries(overrides || {}).forEach(([key, value]) => {
    registry.register(key as any, value);
  });
  
  return registry;
}

export async function runCommand(
  command: Command,
  args: string[] = [],
  options: Record<string, any> = {},
  registry?: ServiceRegistry
): Promise<void> {
  const context: CommandContext = {
    args,
    options,
    registry: registry || mockRegistry()
  };
  
  if (!command.execute) {
    throw new Error(`Command '${command.name}' has no execute function`);
  }
  return command.execute(context);
}

export interface CLITestHarness {
  runCommand(commandName: string, args?: string[], options?: Record<string, any>): Promise<void>;
  getOutput(): string[];
  getLogger(): Logger & { output: string[] };
  getPrompter(): Prompter;
  setPrompterResponses(responses: Record<string, any>): void;
  reset(): void;
}

export function createTestHarness(commands: Record<string, Command>): CLITestHarness {
  let logger = createMockLogger();
  let prompter = createMockPrompter();
  let registry = createRegistry();
  
  // Set up initial registry
  registry.register(LoggerToken, logger);
  registry.register(PrompterToken, prompter);
  
  return {
    async runCommand(commandName: string, args: string[] = [], options: Record<string, any> = {}): Promise<void> {
      const command = commands[commandName];
      if (!command) {
        throw new Error(`Command "${commandName}" not found`);
      }
      
      const context: CommandContext = {
        args,
        options,
        registry
      };
      
      if (!command.execute) {
        throw new Error(`Command '${command.name}' has no execute function`);
      }
      await command.execute(context);
    },
    
    getOutput(): string[] {
      return logger.output;
    },
    
    getLogger(): Logger & { output: string[] } {
      return logger;
    },
    
    getPrompter(): Prompter {
      return prompter;
    },
    
    setPrompterResponses(responses: Record<string, any>): void {
      prompter = createMockPrompter({ responses });
      registry.register(PrompterToken, prompter);
    },
    
    reset(): void {
      logger = createMockLogger();
      prompter = createMockPrompter();
      registry = createRegistry();
      registry.register(LoggerToken, logger);
      registry.register(PrompterToken, prompter);
    }
  };
}

export function captureOutput<T>(fn: () => T): { result: T; stdout: string; stderr: string } {
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  
  let stdout = '';
  let stderr = '';
  
  // @ts-ignore
  process.stdout.write = (chunk: any) => {
    stdout += chunk.toString();
    return true;
  };
  
  // @ts-ignore
  process.stderr.write = (chunk: any) => {
    stderr += chunk.toString();
    return true;
  };
  
  try {
    const result = fn();
    return { result, stdout, stderr };
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
}

export async function captureOutputAsync<T>(fn: () => Promise<T>): Promise<{ result: T; stdout: string; stderr: string }> {
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  
  let stdout = '';
  let stderr = '';
  
  // @ts-ignore
  process.stdout.write = (chunk: any) => {
    stdout += chunk.toString();
    return true;
  };
  
  // @ts-ignore
  process.stderr.write = (chunk: any) => {
    stderr += chunk.toString();
    return true;
  };
  
  try {
    const result = await fn();
    return { result, stdout, stderr };
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
}

export function expectError(fn: () => any, errorType?: any, message?: string | RegExp): void {
  let thrown = false;
  let error: any;
  
  try {
    fn();
  } catch (e) {
    thrown = true;
    error = e;
  }
  
  if (!thrown) {
    throw new Error('Expected function to throw an error');
  }
  
  if (errorType && !(error instanceof errorType)) {
    throw new Error(`Expected error to be instance of ${errorType.name}, got ${error.constructor.name}`);
  }
  
  if (message) {
    const errorMessage = error.message || String(error);
    if (message instanceof RegExp) {
      if (!message.test(errorMessage)) {
        throw new Error(`Expected error message to match ${message}, got "${errorMessage}"`);
      }
    } else if (!errorMessage.includes(message)) {
      throw new Error(`Expected error message to include "${message}", got "${errorMessage}"`);
    }
  }
}

export async function expectErrorAsync(fn: () => Promise<any>, errorType?: any, message?: string | RegExp): Promise<void> {
  let thrown = false;
  let error: any;
  
  try {
    await fn();
  } catch (e) {
    thrown = true;
    error = e;
  }
  
  if (!thrown) {
    throw new Error('Expected function to throw an error');
  }
  
  if (errorType && !(error instanceof errorType)) {
    throw new Error(`Expected error to be instance of ${errorType.name}, got ${error.constructor.name}`);
  }
  
  if (message) {
    const errorMessage = error.message || String(error);
    if (message instanceof RegExp) {
      if (!message.test(errorMessage)) {
        throw new Error(`Expected error message to match ${message}, got "${errorMessage}"`);
      }
    } else if (!errorMessage.includes(message)) {
      throw new Error(`Expected error message to include "${message}", got "${errorMessage}"`);
    }
  }
}