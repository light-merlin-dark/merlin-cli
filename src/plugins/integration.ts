import type { CLI } from '../core/cli.ts';
import type { ServiceRegistry } from '../core/registry.ts';
import type { LoadedPlugin } from './types.ts';
import { PluginLoader } from './loader.ts';

export interface PluginIntegrationOptions {
  enabled?: boolean;
  autoLoad?: boolean;
  pluginPrefix?: string;
  searchPaths?: string[];
  allowLocal?: boolean;
}

export class PluginIntegration {
  private loader: PluginLoader;
  private plugins: LoadedPlugin[] = [];

  constructor(
    private cli: CLI,
    private registry: ServiceRegistry,
    private options: PluginIntegrationOptions = {}
  ) {
    this.loader = new PluginLoader({
      cliName: cli.name,
      pluginPrefix: options.pluginPrefix,
      searchPaths: options.searchPaths,
      allowLocal: options.allowLocal ?? true,
    });
  }

  async initialize(): Promise<void> {
    if (!this.options.enabled) return;

    if (this.options.autoLoad !== false) {
      await this.loadAllPlugins();
    }
  }

  async loadAllPlugins(): Promise<void> {
    this.plugins = await this.loader.loadPlugins();

    for (const plugin of this.plugins) {
      await this.integratePlugin(plugin);
    }
  }

  async loadPlugin(nameOrPath: string): Promise<void> {
    const existingPlugin = this.loader.getPlugin(nameOrPath);
    if (existingPlugin) {
      await this.integratePlugin(existingPlugin);
      return;
    }

    throw new Error(`Plugin ${nameOrPath} not found`);
  }

  private async integratePlugin(plugin: LoadedPlugin): Promise<void> {
    // Run beforeInit hook
    if (plugin.hooks?.beforeInit) {
      await plugin.hooks.beforeInit();
    }

    // Register services
    if (plugin.services) {
      for (const service of plugin.services) {
        if (service.lifecycle === 'singleton') {
          this.registry.register(service.token, service.factory());
        } else {
          this.registry.registerFactory(service.token, service.factory);
        }
      }
    }

    // Register commands
    if (plugin.commands) {
      for (const [name, command] of Object.entries(plugin.commands)) {
        this.cli.registerCommand(name, command);
      }
    }

    // Register middleware
    if (plugin.middleware) {
      for (const middleware of plugin.middleware) {
        this.cli.useMiddleware(middleware);
      }
    }

    // Run afterInit hook
    if (plugin.hooks?.afterInit) {
      await plugin.hooks.afterInit();
    }
  }

  getLoadedPlugins(): LoadedPlugin[] {
    return [...this.plugins];
  }

  isPluginLoaded(name: string): boolean {
    return this.plugins.some(p => p.name === name);
  }

  async runBeforeCommandHooks(commandName: string): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.hooks?.beforeCommand) {
        await plugin.hooks.beforeCommand(commandName);
      }
    }
  }

  async runAfterCommandHooks(commandName: string): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.hooks?.afterCommand) {
        await plugin.hooks.afterCommand(commandName);
      }
    }
  }
}