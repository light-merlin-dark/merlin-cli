#!/usr/bin/env bun
import { createCLI, createCommand, createToken } from '../src/index.ts';
import { existsSync } from 'fs';
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

// Define migration service
interface Migration {
  id: string;
  name: string;
  timestamp: number;
  up: string;
  down: string;
}

interface MigrationService {
  migrationsDir: string;
  getAllMigrations(): Promise<Migration[]>;
  getAppliedMigrations(): Promise<string[]>;
  createMigration(name: string): Promise<Migration>;
  applyMigration(migration: Migration): Promise<void>;
  rollbackMigration(migration: Migration): Promise<void>;
  markAsApplied(migrationId: string): Promise<void>;
  markAsRolledBack(migrationId: string): Promise<void>;
}

const MigrationServiceToken = createToken<MigrationService>('migration-service');

// Mock migration service implementation
class MockMigrationService implements MigrationService {
  migrationsDir = './migrations';
  private appliedMigrationsFile = './.migrations-state.json';

  async getAllMigrations(): Promise<Migration[]> {
    if (!existsSync(this.migrationsDir)) {
      return [];
    }

    const files = await readdir(this.migrationsDir);
    const migrations: Migration[] = [];

    for (const file of files.filter(f => f.endsWith('.sql'))) {
      const content = await readFile(join(this.migrationsDir, file), 'utf-8');
      const [timestamp, ...nameParts] = file.replace('.sql', '').split('_');
      
      migrations.push({
        id: file.replace('.sql', ''),
        name: nameParts.join('_'),
        timestamp: parseInt(timestamp),
        up: this.extractSection(content, '-- UP'),
        down: this.extractSection(content, '-- DOWN')
      });
    }

    return migrations.sort((a, b) => a.timestamp - b.timestamp);
  }

  async getAppliedMigrations(): Promise<string[]> {
    if (!existsSync(this.appliedMigrationsFile)) {
      return [];
    }
    
    const content = await readFile(this.appliedMigrationsFile, 'utf-8');
    return JSON.parse(content).applied || [];
  }

  async createMigration(name: string): Promise<Migration> {
    if (!existsSync(this.migrationsDir)) {
      await mkdir(this.migrationsDir, { recursive: true });
    }

    const timestamp = Date.now();
    const fileName = `${timestamp}_${name.replace(/[^a-zA-Z0-9]/g, '_')}.sql`;
    const filePath = join(this.migrationsDir, fileName);

    const template = `-- UP
-- Write your migration SQL here

-- DOWN
-- Write your rollback SQL here
`;

    await writeFile(filePath, template);

    return {
      id: fileName.replace('.sql', ''),
      name,
      timestamp,
      up: '',
      down: ''
    };
  }

  async applyMigration(migration: Migration): Promise<void> {
    console.log(`Applying migration: ${migration.id}`);
    console.log('SQL:', migration.up);
    // In a real implementation, this would execute the SQL
    await new Promise(resolve => setTimeout(resolve, 500));
    await this.markAsApplied(migration.id);
  }

  async rollbackMigration(migration: Migration): Promise<void> {
    console.log(`Rolling back migration: ${migration.id}`);
    console.log('SQL:', migration.down);
    // In a real implementation, this would execute the SQL
    await new Promise(resolve => setTimeout(resolve, 500));
    await this.markAsRolledBack(migration.id);
  }

  async markAsApplied(migrationId: string): Promise<void> {
    const applied = await this.getAppliedMigrations();
    if (!applied.includes(migrationId)) {
      applied.push(migrationId);
      await this.saveAppliedMigrations(applied);
    }
  }

  async markAsRolledBack(migrationId: string): Promise<void> {
    const applied = await this.getAppliedMigrations();
    const filtered = applied.filter(id => id !== migrationId);
    await this.saveAppliedMigrations(filtered);
  }

  private async saveAppliedMigrations(applied: string[]): Promise<void> {
    await writeFile(this.appliedMigrationsFile, JSON.stringify({ applied }, null, 2));
  }

  private extractSection(content: string, marker: string): string {
    const lines = content.split('\\n');
    const startIndex = lines.findIndex(line => line.trim() === marker);
    if (startIndex === -1) return '';

    const endMarkers = ['-- UP', '-- DOWN'];
    let endIndex = lines.length;

    for (let i = startIndex + 1; i < lines.length; i++) {
      if (endMarkers.includes(lines[i].trim()) && lines[i].trim() !== marker) {
        endIndex = i;
        break;
      }
    }

    return lines
      .slice(startIndex + 1, endIndex)
      .filter(line => line.trim() !== '')
      .join('\\n');
  }
}

// Create the database migration CLI
const cli = createCLI({
  name: 'migrate',
  version: '1.0.0',
  description: 'Database migration CLI example',

  commands: {
    // Create a new migration
    create: createCommand({
      name: 'create',
      description: 'Create a new migration file',
      aliases: ['new'],
      args: {
        name: {
          type: 'string',
          description: 'Migration name',
          required: true,
          validate: (value) => {
            if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
              return 'Migration name must contain only letters, numbers, underscores, and hyphens';
            }
            return true;
          }
        }
      },
      examples: [
        'migrate create add_users_table',
        'migrate create update_posts_schema'
      ],
      async execute({ namedArgs, registry }) {
        const migrationService = registry.get(MigrationServiceToken);
        const logger = registry.get('logger');

        try {
          const migration = await migrationService.createMigration(namedArgs!.name);
          logger.success(`Created migration: ${migration.id}`);
          logger.info(`Edit the file at: ${join(migrationService.migrationsDir, migration.id + '.sql')}`);
        } catch (error) {
          logger.error(`Failed to create migration: ${error}`);
        }
      }
    }),

    // List all migrations
    list: createCommand({
      name: 'list',
      description: 'List all migrations',
      aliases: ['ls', 'status'],
      async execute({ registry }) {
        const migrationService = registry.get(MigrationServiceToken);
        const logger = registry.get('logger');

        try {
          const allMigrations = await migrationService.getAllMigrations();
          const appliedMigrations = await migrationService.getAppliedMigrations();

          if (allMigrations.length === 0) {
            logger.info('No migrations found');
            return;
          }

          logger.info('Migrations:\\n');
          
          for (const migration of allMigrations) {
            const status = appliedMigrations.includes(migration.id) ? '✓' : '○';
            const date = new Date(migration.timestamp).toISOString().split('T')[0];
            console.log(`  ${status} ${migration.id} (${date}) - ${migration.name}`);
          }

          const pending = allMigrations.filter(m => !appliedMigrations.includes(m.id));
          logger.info(`\\nTotal: ${allMigrations.length}, Applied: ${appliedMigrations.length}, Pending: ${pending.length}`);
        } catch (error) {
          logger.error(`Failed to list migrations: ${error}`);
        }
      }
    }),

    // Run pending migrations
    up: createCommand({
      name: 'up',
      description: 'Run all pending migrations',
      aliases: ['migrate'],
      options: {
        target: {
          type: 'string',
          description: 'Migrate up to a specific migration'
        },
        dry: {
          type: 'boolean',
          description: 'Show what would be migrated without applying',
          default: false
        }
      },
      async execute({ options, registry }) {
        const migrationService = registry.get(MigrationServiceToken);
        const logger = registry.get('logger');

        try {
          const allMigrations = await migrationService.getAllMigrations();
          const appliedMigrations = await migrationService.getAppliedMigrations();
          
          let pendingMigrations = allMigrations.filter(m => !appliedMigrations.includes(m.id));

          if (options.target) {
            const targetIndex = pendingMigrations.findIndex(m => m.id === options.target);
            if (targetIndex === -1) {
              logger.error(`Migration ${options.target} not found or already applied`);
              return;
            }
            pendingMigrations = pendingMigrations.slice(0, targetIndex + 1);
          }

          if (pendingMigrations.length === 0) {
            logger.info('No pending migrations');
            return;
          }

          if (options.dry) {
            logger.info('Migrations to be applied:');
            for (const migration of pendingMigrations) {
              console.log(`  - ${migration.id}`);
            }
            return;
          }

          logger.info(`Running ${pendingMigrations.length} migration(s)...\\n`);

          for (const migration of pendingMigrations) {
            logger.info(`Applying: ${migration.id}`);
            await migrationService.applyMigration(migration);
            logger.success(`Applied: ${migration.id}`);
          }

          logger.success(`\\nAll migrations completed successfully`);
        } catch (error) {
          logger.error(`Migration failed: ${error}`);
        }
      }
    }),

    // Rollback migrations
    down: createCommand({
      name: 'down',
      description: 'Rollback migrations',
      aliases: ['rollback'],
      options: {
        steps: {
          type: 'number',
          description: 'Number of migrations to rollback',
          default: 1
        },
        target: {
          type: 'string',
          description: 'Rollback to a specific migration'
        },
        all: {
          type: 'boolean',
          description: 'Rollback all migrations',
          default: false
        }
      },
      async execute({ options, registry }) {
        const migrationService = registry.get(MigrationServiceToken);
        const logger = registry.get('logger');
        const prompter = registry.get('prompter');

        try {
          const allMigrations = await migrationService.getAllMigrations();
          const appliedMigrations = await migrationService.getAppliedMigrations();
          
          const appliedMigrationObjects = allMigrations
            .filter(m => appliedMigrations.includes(m.id))
            .reverse(); // Most recent first

          if (appliedMigrationObjects.length === 0) {
            logger.info('No migrations to rollback');
            return;
          }

          let migrationsToRollback: Migration[] = [];

          if (options.all) {
            migrationsToRollback = appliedMigrationObjects;
          } else if (options.target) {
            const targetIndex = appliedMigrationObjects.findIndex(m => m.id === options.target);
            if (targetIndex === -1) {
              logger.error(`Migration ${options.target} not found or not applied`);
              return;
            }
            migrationsToRollback = appliedMigrationObjects.slice(0, targetIndex);
          } else {
            migrationsToRollback = appliedMigrationObjects.slice(0, options.steps);
          }

          if (migrationsToRollback.length === 0) {
            logger.info('No migrations to rollback');
            return;
          }

          // Confirm rollback
          const confirm = await prompter.confirm(
            `Are you sure you want to rollback ${migrationsToRollback.length} migration(s)?`
          );
          if (!confirm) {
            logger.warn('Rollback cancelled');
            return;
          }

          logger.info(`Rolling back ${migrationsToRollback.length} migration(s)...\\n`);

          for (const migration of migrationsToRollback) {
            logger.info(`Rolling back: ${migration.id}`);
            await migrationService.rollbackMigration(migration);
            logger.success(`Rolled back: ${migration.id}`);
          }

          logger.success(`\\nRollback completed successfully`);
        } catch (error) {
          logger.error(`Rollback failed: ${error}`);
        }
      }
    }),

    // Reset all migrations
    reset: createCommand({
      name: 'reset',
      description: 'Reset all migrations',
      options: {
        force: {
          type: 'boolean',
          description: 'Skip confirmation',
          default: false
        }
      },
      async execute({ options, registry }) {
        const logger = registry.get('logger');
        const prompter = registry.get('prompter');

        if (!options.force) {
          const confirm = await prompter.confirm(
            'Are you sure you want to reset all migrations? This will rollback everything!'
          );
          if (!confirm) {
            logger.warn('Reset cancelled');
            return;
          }
        }

        // Rollback all
        await cli.commands.down.execute({
          args: [],
          options: { all: true },
          registry
        });
      }
    })
  }
});

// Bootstrap to register migration service
cli.bootstrap = async (registry) => {
  const migrationService = new MockMigrationService();
  registry.register(MigrationServiceToken, migrationService);
};

// Run the CLI
cli.run();