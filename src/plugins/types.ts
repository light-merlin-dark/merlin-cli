import type { CommandDefinition, Middleware } from '../types/commands.ts';
import type { Token } from '../types/services.ts';

export interface Plugin {
  name: string;
  version?: string;
  description?: string;
  commands?: Record<string, CommandDefinition>;
  services?: Array<{
    token: Token<any>;
    factory: () => any;
    lifecycle?: 'singleton' | 'transient';
  }>;
  middleware?: Middleware[];
  hooks?: {
    beforeInit?: () => Promise<void> | void;
    afterInit?: () => Promise<void> | void;
    beforeCommand?: (commandName: string) => Promise<void> | void;
    afterCommand?: (commandName: string) => Promise<void> | void;
  };
}

export interface PluginManifest {
  name: string;
  version: string;
  cliPlugin?: string | boolean;
  main?: string;
  [key: string]: any; // Allow dynamic properties for CLI-specific plugin fields
}

export interface PluginLoadOptions {
  cliName: string;
  pluginPrefix?: string;
  searchPaths?: string[];
  allowLocal?: boolean;
}

export interface LoadedPlugin extends Plugin {
  packageName: string;
  packageVersion: string;
  loadPath: string;
}