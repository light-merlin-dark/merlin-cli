// Import types from commands to avoid circular dependencies
import type { CommandDefinition, Middleware, RouteContext } from './commands.ts';
import type { ServiceRegistry, Token } from '../core/registry.ts';

// Re-export Token for convenience
export type { Token } from '../core/registry.ts';

export interface LoggerConfig {
  verbose?: boolean;
  silent?: boolean;
  colors?: boolean;
  prefix?: string;
}

export interface CustomRouterResult {
  command: string;
  args: string[];
  skipNormalRouting?: boolean;
}

export interface CLIConfig {
  name: string;
  version: string;
  description?: string;
  commands?: Record<string, CommandDefinition>;
  registry?: ServiceRegistry;
  middleware?: Middleware[];
  helpOptions?: HelpOptions;
  // Custom routing options
  customRouter?: (args: string[]) => CustomRouterResult | null;
  defaultCommand?: string;
  defaultHandler?: (context: { args: string[]; options: Record<string, any> }) => Promise<void> | void;
  beforeExecute?: (context: { command: string; args: string[]; options: Record<string, any> }) => { command: string; args: string[]; options: Record<string, any> } | null;
  // Plugin configuration
  plugins?: {
    enabled?: boolean;
    autoLoad?: boolean;
    pluginPrefix?: string;
    searchPaths?: string[];
    allowLocal?: boolean;
  };
  // Hooks for extensibility
  onBeforeRoute?: (context: RouteContext) => Promise<void>;
  onAfterRoute?: (context: RouteContext) => Promise<void>;
  onError?: (error: Error, context: RouteContext) => Promise<void>;
}

export interface HelpOptions {
  showExamples?: boolean;
  aiOptimized?: boolean;
  format?: 'plain' | 'markdown' | 'json';
}

export interface BootstrapConfig {
  registry: ServiceRegistry;
}

export interface ReleaseResult {
  released: boolean;
  version: string;
}