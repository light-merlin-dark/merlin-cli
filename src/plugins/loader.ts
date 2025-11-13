import { existsSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { Plugin, PluginManifest, PluginLoadOptions, LoadedPlugin } from './types.ts';

export class PluginLoader {
  private loadedPlugins: Map<string, LoadedPlugin> = new Map();

  constructor(private options: PluginLoadOptions) {}

  async loadPlugins(): Promise<LoadedPlugin[]> {
    const plugins: LoadedPlugin[] = [];
    const packageJsonPath = join(process.cwd(), 'package.json');

    if (!existsSync(packageJsonPath)) {
      return plugins;
    }

    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
    const deps = [
      ...Object.keys(packageJson.dependencies || {}),
      ...Object.keys(packageJson.devDependencies || {}),
    ];

    for (const dep of deps) {
      const plugin = await this.tryLoadPlugin(dep);
      if (plugin) {
        plugins.push(plugin);
        this.loadedPlugins.set(plugin.name, plugin);
      }
    }

    if (this.options.allowLocal) {
      const localPlugins = await this.loadLocalPlugins();
      plugins.push(...localPlugins);
    }

    return plugins;
  }

  private async tryLoadPlugin(packageName: string): Promise<LoadedPlugin | null> {
    try {
      const packageJsonPath = await this.resolvePackageJson(packageName);
      if (!packageJsonPath) return null;

      const manifest: PluginManifest = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
      
      const pluginField = manifest.cliPlugin || manifest[`${this.options.cliName}-plugin`];
      if (!pluginField) return null;

      const isValidPlugin = typeof pluginField === 'boolean' ? pluginField : true;
      if (!isValidPlugin) return null;

      const mainPath = manifest.main || 'index.js';
      const pluginPath = join(dirname(packageJsonPath), mainPath);

      const pluginModule = await import(pluginPath);
      const plugin: Plugin = pluginModule.default || pluginModule;

      if (!plugin.name) {
        throw new Error(`Plugin ${packageName} must export a name property`);
      }

      return {
        ...plugin,
        packageName,
        packageVersion: manifest.version,
        loadPath: pluginPath,
      };
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(`Failed to load plugin ${packageName}:`, error);
      }
      return null;
    }
  }

  private async loadLocalPlugins(): Promise<LoadedPlugin[]> {
    const plugins: LoadedPlugin[] = [];
    const searchPaths = this.options.searchPaths || ['./plugins', './src/plugins'];

    for (const searchPath of searchPaths) {
      const fullPath = join(process.cwd(), searchPath);
      if (!existsSync(fullPath)) continue;

      try {
        const entries = await readdir(fullPath);
        for (const entry of entries) {
          if (entry.endsWith('.ts') || entry.endsWith('.js')) {
            const pluginPath = join(fullPath, entry);
            const plugin = await this.loadLocalPlugin(pluginPath);
            if (plugin) {
              plugins.push(plugin);
            }
          }
        }
      } catch (error) {
        // Ignore directory read errors
      }
    }

    return plugins;
  }

  private async loadLocalPlugin(pluginPath: string): Promise<LoadedPlugin | null> {
    try {
      const pluginModule = await import(pluginPath);
      const plugin: Plugin = pluginModule.default || pluginModule;

      if (!plugin.name) {
        throw new Error(`Plugin at ${pluginPath} must export a name property`);
      }

      return {
        ...plugin,
        packageName: `local:${plugin.name}`,
        packageVersion: plugin.version || '0.0.0',
        loadPath: pluginPath,
      };
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(`Failed to load local plugin ${pluginPath}:`, error);
      }
      return null;
    }
  }

  private async resolvePackageJson(packageName: string): Promise<string | null> {
    const possiblePaths = [
      join(process.cwd(), 'node_modules', packageName, 'package.json'),
      join(dirname(import.meta.url).replace('file://', ''), '../../node_modules', packageName, 'package.json'),
    ];

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        return path;
      }
    }

    try {
      const resolved = require.resolve(`${packageName}/package.json`, { paths: [process.cwd()] });
      return resolved;
    } catch {
      return null;
    }
  }

  getPlugin(name: string): LoadedPlugin | undefined {
    return this.loadedPlugins.get(name);
  }

  getAllPlugins(): LoadedPlugin[] {
    return Array.from(this.loadedPlugins.values());
  }
}