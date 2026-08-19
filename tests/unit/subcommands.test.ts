import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createCLI } from '../../src/index.ts';
import type { Command } from '../../src/types/index.ts';

describe('Subcommand Support', () => {
  // 2.0 writes payload and commentary through the CLI's own streams rather
  // than through `console`, so tests observe them the way a shell would.
  let output: string[] = [];
  let errorOutput: string[] = [];
  let streams: { stdout: { write(c: string): boolean }; stderr: { write(c: string): boolean } };

  beforeEach(() => {
    output = [];
    errorOutput = [];
    streams = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errorOutput.push(chunk); return true; } }
    };
  });

  it('should execute subcommands correctly', async () => {
    const addExecuted = { called: false, args: [] as any[], options: {} as any };
    const listExecuted = { called: false, options: {} as any };

    const dnsCommand: Command = {
      name: 'dns',
      description: 'Manage DNS entries',
      subcommands: {
        add: {
          name: 'add',
          description: 'Add a DNS entry',
          args: {
            domain: {
              type: 'string',
              description: 'Domain name',
              required: true
            }
          },
          execute: async ({ args, options }) => {
            addExecuted.called = true;
            addExecuted.args = args;
            addExecuted.options = options;
          }
        },
        list: {
          name: 'list',
          description: 'List DNS entries',
          execute: async ({ options }) => {
            listExecuted.called = true;
            listExecuted.options = options;
          }
        }
      }
    };

    const cli = createCLI({
      name: 'test-cli',
      version: '1.0.0',
      exitProcess: false,
      streams,
      commands: { dns: dnsCommand }
    });

    // Test executing a subcommand
    await cli.run(['dns', 'add', 'myapp.local']);
    expect(addExecuted.called).toBe(true);
    expect(addExecuted.args).toEqual(['myapp.local']);

    // Reset
    addExecuted.called = false;

    // Test executing another subcommand
    await cli.run(['dns', 'list']);
    expect(listExecuted.called).toBe(true);
  });

  it('should show help when no subcommand is provided', async () => {
    const dnsCommand: Command = {
      name: 'dns',
      description: 'Manage DNS entries',
      subcommands: {
        add: {
          name: 'add',
          description: 'Add a DNS entry',
          execute: async () => {}
        },
        remove: {
          name: 'remove',
          description: 'Remove a DNS entry',
          execute: async () => {}
        }
      }
      // No execute function - requires subcommand
    };

    const cli = createCLI({
      name: 'test-cli',
      version: '1.0.0',
      exitProcess: false,
      streams,
      commands: { dns: dnsCommand }
    });

    await cli.run(['dns']);
    
    // Should show help with subcommands
    const outputText = output.join('\n');
    expect(outputText).toContain('dns');
    expect(outputText).toContain('Manage DNS entries');
    expect(outputText).toContain('Subcommands:');
    expect(outputText).toContain('add');
    expect(outputText).toContain('remove');
  });

  it('should handle invalid subcommands with helpful error', async () => {
    const dnsCommand: Command = {
      name: 'dns',
      description: 'Manage DNS entries',
      subcommands: {
        add: {
          name: 'add',
          description: 'Add a DNS entry',
          execute: async () => {}
        }
      }
    };

    const cli = createCLI({
      name: 'test-cli',
      version: '1.0.0',
      exitProcess: false,
      streams,
      commands: { dns: dnsCommand }
    });

    // run() does not throw — it resolves the exit code it derived and, in
    // normal mode, exits the process. Asserting a throw here is what let this
    // file kill the test runner mid-suite instead of failing honestly.
    const code = await cli.run(['dns', 'invalid']);

    // A caller that named a subcommand that does not exist called wrong, which
    // is exit 2 rather than a runtime failure.
    expect(code).toBe(2);
    expect(errorOutput.join('\n')).toContain("Unknown subcommand 'invalid'");
    expect(errorOutput.join('\n')).toContain('Available: add');
  });

  it('should handle nested help correctly', async () => {
    const dnsCommand: Command = {
      name: 'dns',
      description: 'Manage DNS entries',
      subcommands: {
        add: {
          name: 'add',
          description: 'Add a DNS entry',
          args: {
            domain: {
              type: 'string',
              description: 'Domain to add',
              required: true
            }
          },
          options: {
            ip: {
              type: 'string',
              description: 'IP address',
              default: '127.0.0.1'
            }
          },
          examples: [
            'dns add myapp.local',
            'dns add myapp.local --ip 192.168.1.1'
          ],
          execute: async () => {}
        }
      }
    };

    const cli = createCLI({
      name: 'test-cli',
      version: '1.0.0',
      exitProcess: false,
      streams,
      commands: { dns: dnsCommand }
    });

    // Test help for subcommand
    await cli.run(['help', 'dns', 'add']);
    
    const outputText = output.join('\n');
    expect(outputText).toContain('add');
    expect(outputText).toContain('Add a DNS entry');
    expect(outputText).toContain('Arguments:');
    expect(outputText).toContain('domain');
    expect(outputText).toContain('Options:');
    expect(outputText).toContain('--ip');
    expect(outputText).toContain('Examples:');
  });

  it('should support commands with both execute and subcommands', async () => {
    let mainExecuted = false;
    let subExecuted = false;

    const gitCommand: Command = {
      name: 'git',
      description: 'Git operations',
      execute: async () => {
        mainExecuted = true;
        console.log('Git status...');
      },
      subcommands: {
        clone: {
          name: 'clone',
          description: 'Clone a repository',
          execute: async () => {
            subExecuted = true;
            console.log('Cloning...');
          }
        }
      }
    };

    const cli = createCLI({
      name: 'test-cli',
      version: '1.0.0',
      exitProcess: false,
      streams,
      commands: { git: gitCommand }
    });

    // Execute main command
    await cli.run(['git']);
    expect(mainExecuted).toBe(true);
    expect(subExecuted).toBe(false);

    // Reset
    mainExecuted = false;

    // Execute subcommand
    await cli.run(['git', 'clone']);
    expect(mainExecuted).toBe(false);
    expect(subExecuted).toBe(true);
  });

  it('should pass options correctly to subcommands', async () => {
    let capturedOptions: any = null;

    const dnsCommand: Command = {
      name: 'dns',
      description: 'DNS management',
      subcommands: {
        add: {
          name: 'add',
          description: 'Add DNS entry',
          options: {
            ip: {
              type: 'string',
              description: 'IP address'
            },
            force: {
              type: 'boolean',
              description: 'Force add'
            }
          },
          execute: async ({ options }) => {
            capturedOptions = options;
          }
        }
      }
    };

    const cli = createCLI({
      name: 'test-cli',
      version: '1.0.0',
      exitProcess: false,
      streams,
      commands: { dns: dnsCommand }
    });

    await cli.run(['dns', 'add', '--ip', '192.168.1.1', '--force']);
    
    expect(capturedOptions).toEqual({
      ip: '192.168.1.1',
      force: true
    });
  });
});