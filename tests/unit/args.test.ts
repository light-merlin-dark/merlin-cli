import { describe, test, expect } from 'bun:test';
import { createCommand } from '../../src/commands/create-command.ts';
import { validateArgs } from '../../src/commands/middleware/validate-args.ts';
import { formatCommandHelp } from '../../src/utils/help-formatter.ts';
import type { CommandContext, Command } from '../../src/types/index.ts';
import { createMockLogger, mockRegistry } from '../../src/testing/index.ts';

describe('Args Validation', () => {
  test('validates required string args', async () => {
    const command = createCommand({
      name: 'test',
      description: 'Test command',
      args: {
        namespace: {
          type: 'string',
          description: 'Database namespace',
          required: true
        }
      },
      execute: async (ctx) => ctx.namedArgs?.namespace
    });

    const registry = mockRegistry();
    const context: CommandContext = {
      args: ['mydb'],
      options: {},
      registry
    };

    const result = await command.execute(context);
    expect(result).toBe('mydb');
    expect(context.namedArgs).toEqual({ namespace: 'mydb' });
  });

  test('throws error for missing required args', async () => {
    const command = createCommand({
      name: 'test',
      description: 'Test command',
      args: {
        namespace: {
          type: 'string',
          description: 'Database namespace',
          required: true
        }
      },
      execute: async (ctx) => ctx.namedArgs?.namespace
    });

    const registry = mockRegistry();
    const context: CommandContext = {
      args: [],
      options: {},
      registry
    };

    await expect(command.execute(context)).rejects.toThrow('Missing required argument: namespace');
  });

  test('validates number args', async () => {
    const command = createCommand({
      name: 'test',
      description: 'Test command',
      args: {
        port: {
          type: 'number',
          description: 'Port number',
          required: true
        }
      },
      execute: async (ctx) => ctx.namedArgs?.port
    });

    const registry = mockRegistry();
    const context: CommandContext = {
      args: ['3000'],
      options: {},
      registry
    };

    const result = await command.execute(context);
    expect(result).toBe(3000);
    expect(context.namedArgs?.port).toBe(3000);
  });

  test('throws error for invalid number args', async () => {
    const command = createCommand({
      name: 'test',
      description: 'Test command',
      args: {
        port: {
          type: 'number',
          description: 'Port number',
          required: true
        }
      },
      execute: async (ctx) => ctx.namedArgs?.port
    });

    const registry = mockRegistry();
    const context: CommandContext = {
      args: ['invalid'],
      options: {},
      registry
    };

    await expect(command.execute(context)).rejects.toThrow('Argument port must be a number');
  });

  test('validates args with custom validation', async () => {
    const command = createCommand({
      name: 'test',
      description: 'Test command',
      args: {
        namespace: {
          type: 'string',
          description: 'Database namespace',
          required: true,
          validate: (value) => {
            if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
              return 'Namespace must contain only letters, numbers, hyphens, and underscores';
            }
            return true;
          }
        }
      },
      execute: async (ctx) => ctx.namedArgs?.namespace
    });

    const registry = mockRegistry();
    
    // Valid namespace
    const validContext: CommandContext = {
      args: ['my-namespace_1'],
      options: {},
      registry
    };
    const result = await command.execute(validContext);
    expect(result).toBe('my-namespace_1');

    // Invalid namespace
    const invalidContext: CommandContext = {
      args: ['my namespace!'],
      options: {},
      registry
    };
    await expect(command.execute(invalidContext)).rejects.toThrow('Namespace must contain only letters, numbers, hyphens, and underscores');
  });

  test('handles multiple args in order', async () => {
    const command = createCommand({
      name: 'test',
      description: 'Test command',
      args: {
        database: {
          type: 'string',
          description: 'Database name',
          required: true
        },
        table: {
          type: 'string',
          description: 'Table name',
          required: false
        }
      },
      execute: async (ctx) => ({
        database: ctx.namedArgs?.database,
        table: ctx.namedArgs?.table
      })
    });

    const registry = mockRegistry();
    const context: CommandContext = {
      args: ['mydb', 'mytable'],
      options: {},
      registry
    };

    const result = await command.execute(context);
    expect(result).toEqual({
      database: 'mydb',
      table: 'mytable'
    });
  });

  test('works with optional args', async () => {
    const command = createCommand({
      name: 'test',
      description: 'Test command',
      args: {
        database: {
          type: 'string',
          description: 'Database name',
          required: true
        },
        table: {
          type: 'string',
          description: 'Table name',
          required: false
        }
      },
      execute: async (ctx) => ({
        database: ctx.namedArgs?.database,
        table: ctx.namedArgs?.table
      })
    });

    const registry = mockRegistry();
    const context: CommandContext = {
      args: ['mydb'],
      options: {},
      registry
    };

    const result = await command.execute(context);
    expect(result).toEqual({
      database: 'mydb',
      table: undefined
    });
  });
});

describe('Args Help Formatting', () => {
  test('displays args in help text', () => {
    const command: Command = {
      name: 'deploy',
      description: 'Deploy application',
      args: {
        environment: {
          type: 'string',
          description: 'Target environment',
          required: true
        },
        version: {
          type: 'string',
          description: 'Version to deploy',
          required: false
        }
      },
      execute: async () => {}
    };

    const help = formatCommandHelp(command);
    
    expect(help).toContain('deploy <environment> [version]');
    expect(help).toContain('Arguments:');
    expect(help).toContain('environment  Target environment (required) [string]');
    expect(help).toContain('version  Version to deploy [string]');
  });

  test('shows usage without args when none defined', () => {
    const command: Command = {
      name: 'status',
      description: 'Show status',
      execute: async () => {}
    };

    const help = formatCommandHelp(command);
    expect(help).toContain('status');
    expect(help).not.toContain('Arguments:');
  });

  test('includes args in JSON format', () => {
    const command: Command = {
      name: 'test',
      description: 'Test command',
      args: {
        input: {
          type: 'string',
          description: 'Input file',
          required: true
        }
      },
      execute: async () => {}
    };

    const json = formatCommandHelp(command, { format: 'json' });
    const parsed = JSON.parse(json);
    
    expect(parsed.args).toBeDefined();
    expect(parsed.args.input).toEqual({
      type: 'string',
      description: 'Input file',
      required: true
    });
  });
});