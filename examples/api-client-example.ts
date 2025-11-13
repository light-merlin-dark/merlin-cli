#!/usr/bin/env bun
import { createCLI, createCommand, createToken } from '../src/index.ts';
import type { Logger } from '../src/index.ts';

// Define API client service
interface APIClient {
  baseURL: string;
  headers: Record<string, string>;
  get(path: string): Promise<any>;
  post(path: string, data: any): Promise<any>;
  put(path: string, data: any): Promise<any>;
  delete(path: string): Promise<any>;
}

const APIClientToken = createToken<APIClient>('api-client');

// Mock API client implementation
class MockAPIClient implements APIClient {
  constructor(
    public baseURL: string,
    public headers: Record<string, string> = {}
  ) {}

  private async request(method: string, path: string, data?: any): Promise<any> {
    const url = `${this.baseURL}${path}`;
    console.log(`${method} ${url}`);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Return mock responses
    switch (path) {
      case '/users':
        return [
          { id: 1, name: 'John Doe', email: 'john@example.com' },
          { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
        ];
      case '/users/1':
        return { id: 1, name: 'John Doe', email: 'john@example.com' };
      case '/posts':
        return [
          { id: 1, title: 'First Post', userId: 1 },
          { id: 2, title: 'Second Post', userId: 2 }
        ];
      default:
        if (method === 'POST') {
          return { ...data, id: Date.now() };
        }
        return { success: true };
    }
  }

  async get(path: string): Promise<any> {
    return this.request('GET', path);
  }

  async post(path: string, data: any): Promise<any> {
    return this.request('POST', path, data);
  }

  async put(path: string, data: any): Promise<any> {
    return this.request('PUT', path, data);
  }

  async delete(path: string): Promise<any> {
    return this.request('DELETE', path);
  }
}

// Create the API client CLI
const cli = createCLI({
  name: 'api-cli',
  version: '1.0.0',
  description: 'Example API client CLI',

  commands: {
    // Configure API endpoint
    config: createCommand({
      name: 'config',
      description: 'Configure API settings',
      options: {
        url: {
          type: 'string',
          description: 'API base URL',
          required: true
        },
        token: {
          type: 'string',
          description: 'API authentication token'
        }
      },
      async execute({ options, registry }) {
        const logger = registry.get('logger');
        
        // In a real app, you'd save this to a config file
        logger.success(`API configured:`);
        logger.info(`  Base URL: ${options.url}`);
        if (options.token) {
          logger.info(`  Token: ${options.token.slice(0, 10)}...`);
        }
      }
    }),

    // List resources
    list: createCommand({
      name: 'list',
      description: 'List resources from the API',
      aliases: ['ls'],
      options: {
        resource: {
          type: 'string',
          description: 'Resource type (users, posts)',
          default: 'users'
        },
        limit: {
          type: 'number',
          description: 'Number of items to show',
          default: 10
        },
        format: {
          type: 'string',
          description: 'Output format (json, table)',
          default: 'table'
        }
      },
      async execute({ options, registry }) {
        const api = registry.get(APIClientToken);
        const logger = registry.get('logger');
        
        logger.info(`Fetching ${options.resource}...`);
        
        try {
          const data = await api.get(`/${options.resource}`);
          const limited = data.slice(0, options.limit);
          
          if (options.format === 'json') {
            console.log(JSON.stringify(limited, null, 2));
          } else {
            console.table(limited);
          }
          
          if (data.length > options.limit) {
            logger.info(`\\nShowing ${options.limit} of ${data.length} items`);
          }
        } catch (error) {
          logger.error(`Failed to fetch ${options.resource}: ${error}`);
        }
      }
    }),

    // Get a specific resource
    get: createCommand({
      name: 'get',
      description: 'Get a specific resource',
      options: {
        resource: {
          type: 'string',
          description: 'Resource type',
          required: true
        },
        id: {
          type: 'string',
          description: 'Resource ID',
          required: true
        }
      },
      async execute({ options, registry }) {
        const api = registry.get(APIClientToken);
        const logger = registry.get('logger');
        
        logger.info(`Fetching ${options.resource}/${options.id}...`);
        
        try {
          const data = await api.get(`/${options.resource}/${options.id}`);
          console.log(JSON.stringify(data, null, 2));
        } catch (error) {
          logger.error(`Failed to fetch resource: ${error}`);
        }
      }
    }),

    // Create a new resource
    create: createCommand({
      name: 'create',
      description: 'Create a new resource',
      options: {
        resource: {
          type: 'string',
          description: 'Resource type',
          required: true
        },
        data: {
          type: 'string',
          description: 'JSON data for the resource',
          required: true
        }
      },
      async execute({ options, registry }) {
        const api = registry.get(APIClientToken);
        const logger = registry.get('logger');
        
        try {
          const data = JSON.parse(options.data);
          logger.info(`Creating ${options.resource}...`);
          
          const result = await api.post(`/${options.resource}`, data);
          logger.success(`Created ${options.resource}:`);
          console.log(JSON.stringify(result, null, 2));
        } catch (error) {
          if (error instanceof SyntaxError) {
            logger.error('Invalid JSON data provided');
          } else {
            logger.error(`Failed to create resource: ${error}`);
          }
        }
      }
    }),

    // Update a resource
    update: createCommand({
      name: 'update',
      description: 'Update an existing resource',
      options: {
        resource: {
          type: 'string',
          description: 'Resource type',
          required: true
        },
        id: {
          type: 'string',
          description: 'Resource ID',
          required: true
        },
        data: {
          type: 'string',
          description: 'JSON data to update',
          required: true
        }
      },
      async execute({ options, registry }) {
        const api = registry.get(APIClientToken);
        const logger = registry.get('logger');
        
        try {
          const data = JSON.parse(options.data);
          logger.info(`Updating ${options.resource}/${options.id}...`);
          
          const result = await api.put(`/${options.resource}/${options.id}`, data);
          logger.success(`Updated ${options.resource}:`);
          console.log(JSON.stringify(result, null, 2));
        } catch (error) {
          if (error instanceof SyntaxError) {
            logger.error('Invalid JSON data provided');
          } else {
            logger.error(`Failed to update resource: ${error}`);
          }
        }
      }
    }),

    // Delete a resource
    delete: createCommand({
      name: 'delete',
      description: 'Delete a resource',
      aliases: ['rm'],
      options: {
        resource: {
          type: 'string',
          description: 'Resource type',
          required: true
        },
        id: {
          type: 'string',
          description: 'Resource ID',
          required: true
        },
        force: {
          type: 'boolean',
          description: 'Skip confirmation',
          default: false
        }
      },
      async execute({ options, registry }) {
        const api = registry.get(APIClientToken);
        const logger = registry.get('logger');
        const prompter = registry.get('prompter');
        
        if (!options.force) {
          const confirm = await prompter.confirm(
            `Are you sure you want to delete ${options.resource}/${options.id}?`
          );
          if (!confirm) {
            logger.warn('Delete cancelled');
            return;
          }
        }
        
        logger.info(`Deleting ${options.resource}/${options.id}...`);
        
        try {
          await api.delete(`/${options.resource}/${options.id}`);
          logger.success(`Deleted ${options.resource}/${options.id}`);
        } catch (error) {
          logger.error(`Failed to delete resource: ${error}`);
        }
      }
    }),

    // Interactive mode
    interactive: createCommand({
      name: 'interactive',
      description: 'Interactive API explorer',
      aliases: ['i'],
      async execute({ registry }) {
        const api = registry.get(APIClientToken);
        const logger = registry.get('logger');
        const prompter = registry.get('prompter');
        
        logger.info('API Interactive Mode (type "help" for commands, "exit" to quit)\\n');
        
        const commands = {
          help: () => {
            console.log('Available commands:');
            console.log('  list <resource>     - List resources');
            console.log('  get <resource> <id> - Get a specific resource');
            console.log('  create <resource>   - Create a new resource');
            console.log('  update <resource> <id> - Update a resource');
            console.log('  delete <resource> <id> - Delete a resource');
            console.log('  exit                - Exit interactive mode');
          },
          list: async (resource: string) => {
            const data = await api.get(`/${resource}`);
            console.table(data);
          },
          get: async (resource: string, id: string) => {
            const data = await api.get(`/${resource}/${id}`);
            console.log(JSON.stringify(data, null, 2));
          },
          exit: () => null
        };
        
        let running = true;
        while (running) {
          const input = await prompter.prompt('api> ');
          const [cmd, ...args] = input.trim().split(' ');
          
          if (cmd === 'exit') {
            running = false;
            break;
          }
          
          if (cmd in commands) {
            try {
              await commands[cmd as keyof typeof commands](...args);
            } catch (error) {
              logger.error(`Error: ${error}`);
            }
          } else if (cmd) {
            logger.error(`Unknown command: ${cmd}`);
          }
        }
        
        logger.info('\\nExiting interactive mode');
      }
    })
  }
});

// Bootstrap to register API client
cli.bootstrap = async (registry) => {
  // In a real app, you'd load config from a file
  const apiClient = new MockAPIClient('https://api.example.com', {
    'Authorization': 'Bearer mock-token'
  });
  
  registry.register(APIClientToken, apiClient);
};

// Run the CLI
cli.run();