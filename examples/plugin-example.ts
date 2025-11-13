#!/usr/bin/env bun
import { createCLI, createCommand } from '../src/index.ts';
import databasePlugin from './plugins/database-plugin.ts';

// Create a CLI with plugin support
const cli = createCLI({
  name: 'my-app',
  version: '1.0.0',
  description: 'Example CLI with plugin support',
  
  // Enable plugins
  plugins: {
    enabled: true,
    autoLoad: true,
    allowLocal: true,
    searchPaths: ['./examples/plugins']
  },

  // Add some base commands
  commands: {
    status: createCommand({
      name: 'status',
      description: 'Show application status',
      async execute({ registry }) {
        const logger = registry.get('logger');
        const config = registry.get('config');
        
        logger.info(`${config.name} v${config.version}`);
        logger.info('Application is running');
        
        // Check if plugins are loaded
        if (cli.plugins) {
          const loadedPlugins = cli.plugins.getLoadedPlugins();
          if (loadedPlugins.length > 0) {
            logger.info('\\nLoaded plugins:');
            for (const plugin of loadedPlugins) {
              logger.info(`  - ${plugin.name} v${plugin.version || 'unknown'}`);
            }
          }
        }
      }
    }),

    'plugin:list': createCommand({
      name: 'plugin:list',
      description: 'List all loaded plugins',
      async execute({ registry }) {
        const logger = registry.get('logger');
        
        if (!cli.plugins) {
          logger.warn('Plugin system is not enabled');
          return;
        }
        
        const plugins = cli.plugins.getLoadedPlugins();
        
        if (plugins.length === 0) {
          logger.info('No plugins loaded');
          return;
        }
        
        logger.info('Loaded plugins:\\n');
        for (const plugin of plugins) {
          logger.info(`${plugin.name} (v${plugin.version || 'unknown'})`);
          if (plugin.description) {
            logger.info(`  ${plugin.description}`);
          }
          
          // Show commands provided by plugin
          if (plugin.commands) {
            const commandNames = Object.keys(plugin.commands);
            if (commandNames.length > 0) {
              logger.info(`  Commands: ${commandNames.join(', ')}`);
            }
          }
          
          // Show services provided by plugin
          if (plugin.services && plugin.services.length > 0) {
            logger.info(`  Services: ${plugin.services.length} registered`);
          }
          
          logger.info('');
        }
      }
    })
  }
});

// Custom bootstrap to manually load plugins if needed
cli.bootstrap = async (registry) => {
  const logger = registry.get('logger');
  
  // Manually load a specific plugin (in addition to auto-loaded ones)
  if (cli.plugins) {
    try {
      // The plugin would already be loaded if it's in the search paths
      // This is just to demonstrate the API
      if (!cli.plugins.isPluginLoaded('database-plugin')) {
        // In a real scenario, you might load from a specific path
        logger.debug('Database plugin already loaded via auto-load');
      }
    } catch (error) {
      logger.error(`Failed to load plugin: ${error}`);
    }
  }
};

// Run the CLI
cli.run();