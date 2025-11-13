import { createCommand, createToken, type Plugin } from '../../src/index.ts';

// Define a token for our database service
interface Database {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  migrate(): Promise<void>;
  seed(): Promise<void>;
  query(sql: string): Promise<any[]>;
}

const DatabaseToken = createToken<Database>('database');

// Mock database implementation
class MockDatabase implements Database {
  private connected = false;

  async connect(): Promise<void> {
    console.log('Connecting to database...');
    await new Promise(resolve => setTimeout(resolve, 500));
    this.connected = true;
    console.log('Connected to database');
  }

  async disconnect(): Promise<void> {
    console.log('Disconnecting from database...');
    await new Promise(resolve => setTimeout(resolve, 200));
    this.connected = false;
    console.log('Disconnected from database');
  }

  async migrate(): Promise<void> {
    if (!this.connected) {
      throw new Error('Database not connected');
    }
    console.log('Running database migrations...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('Migrations completed successfully');
  }

  async seed(): Promise<void> {
    if (!this.connected) {
      throw new Error('Database not connected');
    }
    console.log('Seeding database...');
    await new Promise(resolve => setTimeout(resolve, 800));
    console.log('Database seeded successfully');
  }

  async query(sql: string): Promise<any[]> {
    if (!this.connected) {
      throw new Error('Database not connected');
    }
    console.log(`Executing query: ${sql}`);
    return [];
  }
}

// Define the plugin
const databasePlugin: Plugin = {
  name: 'database-plugin',
  version: '1.0.0',
  description: 'Adds database commands to the CLI',

  // Register the database service
  services: [
    {
      token: DatabaseToken,
      factory: () => new MockDatabase(),
      lifecycle: 'singleton'
    }
  ],

  // Add database-related commands
  commands: {
    'db:migrate': createCommand({
      name: 'db:migrate',
      description: 'Run database migrations',
      options: {
        env: {
          type: 'string',
          description: 'Environment to migrate',
          default: 'development'
        },
        force: {
          type: 'boolean',
          description: 'Force migrations even if up to date',
          default: false
        }
      },
      async execute({ registry, options }) {
        const db = registry.get(DatabaseToken);
        const logger = registry.get('logger');

        logger.info(`Running migrations for ${options.env} environment...`);
        
        await db.connect();
        try {
          await db.migrate();
          logger.success('Migrations completed successfully');
        } finally {
          await db.disconnect();
        }
      }
    }),

    'db:seed': createCommand({
      name: 'db:seed',
      description: 'Seed the database with sample data',
      options: {
        env: {
          type: 'string',
          description: 'Environment to seed',
          default: 'development'
        }
      },
      async execute({ registry, options }) {
        const db = registry.get(DatabaseToken);
        const logger = registry.get('logger');

        if (options.env === 'production') {
          const prompter = registry.get('prompter');
          const confirm = await prompter.confirm(
            'Are you sure you want to seed the production database?'
          );
          if (!confirm) {
            logger.warn('Seed operation cancelled');
            return;
          }
        }

        logger.info(`Seeding database for ${options.env} environment...`);
        
        await db.connect();
        try {
          await db.seed();
          logger.success('Database seeded successfully');
        } finally {
          await db.disconnect();
        }
      }
    }),

    'db:console': createCommand({
      name: 'db:console',
      description: 'Open an interactive database console',
      aliases: ['db', 'dbconsole'],
      async execute({ registry }) {
        const db = registry.get(DatabaseToken);
        const logger = registry.get('logger');
        const prompter = registry.get('prompter');

        logger.info('Opening database console...');
        await db.connect();

        try {
          let running = true;
          while (running) {
            const query = await prompter.prompt('db> ');
            
            if (query.toLowerCase() === 'exit' || query.toLowerCase() === 'quit') {
              running = false;
              break;
            }

            if (query.trim()) {
              try {
                const results = await db.query(query);
                if (results.length > 0) {
                  console.table(results);
                } else {
                  logger.info('Query executed successfully');
                }
              } catch (error) {
                logger.error(`Query error: ${error}`);
              }
            }
          }
        } finally {
          await db.disconnect();
          logger.info('Database console closed');
        }
      }
    })
  },

  // Add hooks
  hooks: {
    beforeInit: async () => {
      console.log('Database plugin initializing...');
    },
    afterInit: async () => {
      console.log('Database plugin initialized');
    },
    beforeCommand: async (commandName: string) => {
      if (commandName.startsWith('db:')) {
        console.log(`Preparing database command: ${commandName}`);
      }
    }
  },

  // Add middleware
  middleware: [
    async (context, command, next) => {
      // Log database commands
      if (command.name.startsWith('db:')) {
        const start = Date.now();
        await next();
        const duration = Date.now() - start;
        console.log(`Database command completed in ${duration}ms`);
      } else {
        await next();
      }
    }
  ]
};

export default databasePlugin;