// Type-safe service tokens
export interface Token<T> {
  readonly key: string;
  readonly __type?: T; // Phantom type for TypeScript
}

export function createToken<T>(key: string): Token<T> {
  return { key };
}

// Service map for declaration merging
export interface ServiceMap {
  'logger': Logger;
  'config': CLIConfig;
  'prompter': Prompter;
}

// Import types (will be defined in respective modules)
export interface Logger {
  info(message: string): void;
  error(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
  success(message: string): void;
  log(level: LogLevel, message: string): void;
}

export type LogLevel = 'info' | 'error' | 'warn' | 'debug' | 'success';

export interface CLIConfig {
  name: string;
  version: string;
  description?: string;
  customRouter?: (args: string[]) => CustomRouterResult | null;
  defaultCommand?: string;
  defaultHandler?: (context: { args: string[]; options: Record<string, any> }) => Promise<void> | void;
  beforeExecute?: (context: { command: string; args: string[]; options: Record<string, any> }) => { command: string; args: string[]; options: Record<string, any> } | null;
}

export interface CustomRouterResult {
  command: string;
  args: string[];
  skipNormalRouting?: boolean;
}

export interface Prompter {
  confirm(message: string, initial?: boolean): Promise<boolean>;
  text(message: string, initial?: string): Promise<string>;
  select<T = string>(message: string, choices: Array<{ title: string; value: T }>): Promise<T>;
  multiselect<T = string>(message: string, choices: Array<{ title: string; value: T }>): Promise<T[]>;
  ask(questions: any): Promise<any>;
}

// Built-in service tokens
export const LoggerToken = createToken<Logger>('logger');
export const ConfigToken = createToken<CLIConfig>('config');
export const PrompterToken = createToken<Prompter>('prompter');

export class ServiceRegistry {
  private services = new Map<string, any>();
  private factories = new Map<string, () => any>();

  // Token-based registration (preferred)
  register<T>(token: Token<T>, service: T): void;
  // Legacy string-based registration (for backward compatibility)
  register<K extends keyof ServiceMap>(name: K, service: ServiceMap[K]): void;
  register<T>(tokenOrName: Token<T> | string, service: T): void {
    const key = typeof tokenOrName === 'string' ? tokenOrName : tokenOrName.key;
    this.services.set(key, service);
  }

  registerFactory<T>(token: Token<T>, factory: () => T): void;
  registerFactory<K extends keyof ServiceMap>(name: K, factory: () => ServiceMap[K]): void;
  registerFactory<T>(tokenOrName: Token<T> | string, factory: () => T): void {
    const key = typeof tokenOrName === 'string' ? tokenOrName : tokenOrName.key;
    this.factories.set(key, factory);
  }

  // Token-based get (preferred)
  get<T>(token: Token<T>): T;
  // Legacy string-based get (for backward compatibility)
  get<K extends keyof ServiceMap>(name: K): ServiceMap[K];
  get<T>(tokenOrName: Token<T> | string): T {
    const key = typeof tokenOrName === 'string' ? tokenOrName : tokenOrName.key;

    if (this.services.has(key)) {
      return this.services.get(key) as T;
    }

    const factory = this.factories.get(key);
    if (factory) {
      const service = factory();
      this.services.set(key, service);
      return service as T;
    }

    throw new Error(`Service '${key}' not found`);
  }

  has(tokenOrName: Token<any> | string): boolean {
    const key = typeof tokenOrName === 'string' ? tokenOrName : tokenOrName.key;
    return this.services.has(key) || this.factories.has(key);
  }

  clear(): void {
    this.services.clear();
    this.factories.clear();
  }
}

export function createRegistry(): ServiceRegistry {
  return new ServiceRegistry();
}