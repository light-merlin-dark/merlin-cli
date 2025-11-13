import type { ServiceRegistry } from '../core/registry.ts';

export interface CommandContext {
  args: string[];
  namedArgs?: Record<string, any>;
  options: Record<string, any>;
  registry: ServiceRegistry;
}

export interface Command<T = any> {
  name: string;
  description: string;
  usage?: string;
  examples?: string[];
  options?: Record<string, OptionSpec>;
  args?: Record<string, ArgSpec>;
  aliases?: string[];
  subcommands?: Record<string, Command>;
  execute?: (context: CommandContext) => Promise<T> | T;
}

export interface OptionSpec {
  type: 'string' | 'boolean' | 'number' | 'array';
  description: string;
  default?: any;
  required?: boolean;
  alias?: string;
  validate?: (value: any) => boolean | string;
}

export interface ArgSpec {
  type: 'string' | 'number';
  description: string;
  required?: boolean;
  validate?: (value: any) => boolean | string;
}

export interface CommandSpec<T = any> {
  name: string;
  description: string;
  usage?: string;
  examples?: string[];
  options?: Record<string, OptionSpec>;
  args?: Record<string, ArgSpec>;
  aliases?: string[];
  middleware?: Middleware[];
  subcommands?: Record<string, CommandSpec>;
  execute?: CommandExecutor<T>;
}

export type CommandExecutor<T> = (context: CommandContext) => Promise<T> | T;

export type Middleware = (context: CommandContext, command: CommandDefinition, next: () => Promise<void>) => Promise<void>;

export type CommandDefinition = Command | (() => Promise<Command>);

export interface RouteContext {
  commandName: string;
  args: string[];
  options: Record<string, any>;
}