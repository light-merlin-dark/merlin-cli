#!/usr/bin/env bun
import { createCLI, createCommand } from '../src/index.ts';

// Example demonstrating the new args functionality
const cli = createCLI({
  name: 'args-demo',
  version: '1.0.0',
  description: 'Demonstration of positional arguments feature',

  commands: {
    // Simple example with one required argument
    greet: createCommand({
      name: 'greet',
      description: 'Greet someone by name',
      args: {
        name: {
          type: 'string',
          description: 'Name of person to greet',
          required: true
        }
      },
      examples: [
        'args-demo greet Alice',
        'args-demo greet "John Doe"'
      ],
      async execute({ namedArgs, registry }) {
        const logger = registry.get('logger');
        logger.info(`Hello, ${namedArgs!.name}!`);
      }
    }),

    // Example with multiple arguments (required and optional)
    deploy: createCommand({
      name: 'deploy',
      description: 'Deploy application to environment',
      args: {
        environment: {
          type: 'string',
          description: 'Target environment (dev, staging, prod)',
          required: true,
          validate: (value) => {
            const valid = ['dev', 'staging', 'prod'];
            if (!valid.includes(value)) {
              return `Environment must be one of: ${valid.join(', ')}`;
            }
            return true;
          }
        },
        version: {
          type: 'string',
          description: 'Version to deploy (defaults to latest)',
          required: false
        }
      },
      options: {
        force: {
          type: 'boolean',
          description: 'Force deployment without confirmation',
          default: false
        },
        timeout: {
          type: 'number',
          description: 'Deployment timeout in seconds',
          default: 300
        }
      },
      examples: [
        'args-demo deploy staging',
        'args-demo deploy prod v1.2.3',
        'args-demo deploy staging --force --timeout 600'
      ],
      async execute({ namedArgs, options, registry }) {
        const logger = registry.get('logger');
        
        const env = namedArgs!.environment;
        const version = namedArgs!.version || 'latest';
        
        logger.info(`Deploying version ${version} to ${env}...`);
        
        if (options.force) {
          logger.warn('Force deployment enabled - skipping safety checks');
        }
        
        logger.info(`Timeout set to ${options.timeout} seconds`);
        
        // Simulate deployment
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        logger.success(`Successfully deployed ${version} to ${env}!`);
      }
    }),

    // Example with number argument validation
    server: createCommand({
      name: 'server',
      description: 'Start development server',
      args: {
        port: {
          type: 'number',
          description: 'Port number to listen on',
          required: true,
          validate: (port) => {
            if (port < 1024 || port > 65535) {
              return 'Port must be between 1024 and 65535';
            }
            return true;
          }
        }
      },
      options: {
        host: {
          type: 'string',
          description: 'Host to bind to',
          default: 'localhost'
        },
        https: {
          type: 'boolean',
          description: 'Use HTTPS',
          default: false
        }
      },
      examples: [
        'args-demo server 3000',
        'args-demo server 8080 --host 0.0.0.0',
        'args-demo server 443 --https'
      ],
      async execute({ namedArgs, options, registry }) {
        const logger = registry.get('logger');
        
        const port = namedArgs!.port;
        const protocol = options.https ? 'https' : 'http';
        const url = `${protocol}://${options.host}:${port}`;
        
        logger.info(`Starting server on ${url}`);
        logger.info('Press Ctrl+C to stop');
        
        // Simulate server start
        await new Promise(resolve => setTimeout(resolve, 500));
        
        logger.success(`Server running at ${url}`);
      }
    }),

    // Example with namespace pattern validation
    namespace: createCommand({
      name: 'namespace',
      description: 'Create or manage a namespace',
      args: {
        action: {
          type: 'string',
          description: 'Action to perform',
          required: true,
          validate: (value) => {
            const actions = ['create', 'delete', 'list', 'describe'];
            if (!actions.includes(value)) {
              return `Action must be one of: ${actions.join(', ')}`;
            }
            return true;
          }
        },
        name: {
          type: 'string',
          description: 'Namespace name (required for create/delete/describe)',
          required: false,
          validate: (value) => {
            if (!value) return true; // Optional field
            if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
              return 'Namespace name must contain only letters, numbers, hyphens, and underscores';
            }
            if (value.length < 3 || value.length > 50) {
              return 'Namespace name must be between 3 and 50 characters';
            }
            return true;
          }
        }
      },
      examples: [
        'args-demo namespace create my-app',
        'args-demo namespace delete old-project',
        'args-demo namespace list',
        'args-demo namespace describe production'
      ],
      async execute({ namedArgs, registry }) {
        const logger = registry.get('logger');
        
        const action = namedArgs!.action;
        const name = namedArgs!.name;
        
        // Validate that name is provided when required
        if (['create', 'delete', 'describe'].includes(action) && !name) {
          logger.error(`Namespace name is required for action: ${action}`);
          return;
        }
        
        switch (action) {
          case 'create':
            logger.info(`Creating namespace: ${name}`);
            await new Promise(resolve => setTimeout(resolve, 500));
            logger.success(`Namespace '${name}' created successfully`);
            break;
            
          case 'delete':
            logger.warn(`Deleting namespace: ${name}`);
            await new Promise(resolve => setTimeout(resolve, 500));
            logger.success(`Namespace '${name}' deleted successfully`);
            break;
            
          case 'list':
            logger.info('Available namespaces:');
            console.log('  - production');
            console.log('  - staging');
            console.log('  - development');
            break;
            
          case 'describe':
            logger.info(`Namespace: ${name}`);
            console.log(`  Status: Active`);
            console.log(`  Created: 2024-01-01`);
            console.log(`  Resources: 42`);
            break;
        }
      }
    })
  }
});

// Run the CLI
cli.run();