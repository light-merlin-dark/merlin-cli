import { test, expect, describe } from 'bun:test';
import { createCLI, resolveExitCode, isFailureResult } from '../../src/index.ts';

describe('resolveExitCode', () => {
  test('void commands exit 0', () => {
    expect(resolveExitCode(undefined)).toBe(0);
    expect(resolveExitCode(null)).toBe(0);
  });

  test('data payloads exit 0', () => {
    expect(resolveExitCode({ zones: ['a'], count: 1 })).toBe(0);
    expect(resolveExitCode('some output')).toBe(0);
    expect(resolveExitCode(0)).toBe(0);
    expect(resolveExitCode(7)).toBe(0);
    expect(resolveExitCode([1, 2, 3])).toBe(0);
    expect(resolveExitCode(false)).toBe(0);
  });

  test('success: true exits 0', () => {
    expect(resolveExitCode({ success: true, message: 'done' })).toBe(0);
  });

  test('success: false exits 1', () => {
    expect(resolveExitCode({ success: false, error: 'nope' })).toBe(1);
  });

  test('explicit exitCode wins over success', () => {
    expect(resolveExitCode({ success: false, exitCode: 42 })).toBe(42);
    expect(resolveExitCode({ exitCode: 7 })).toBe(7);
    expect(resolveExitCode({ success: false, exitCode: 0 })).toBe(0);
  });

  test('out-of-range exit codes collapse to 1 rather than wrapping to 0', () => {
    // process.exit(256) silently reports 0 — that would reopen the fail-open.
    expect(resolveExitCode({ exitCode: 256 })).toBe(1);
    expect(resolveExitCode({ exitCode: -1 })).toBe(1);
    expect(resolveExitCode({ exitCode: NaN })).toBe(1);
    expect(resolveExitCode({ exitCode: Infinity })).toBe(1);
  });

  test('non-numeric exitCode falls back to the success flag', () => {
    expect(resolveExitCode({ success: false, exitCode: 'nope' })).toBe(1);
    expect(resolveExitCode({ success: true, exitCode: 'nope' })).toBe(0);
  });

  test('isFailureResult mirrors resolveExitCode', () => {
    expect(isFailureResult({ success: false })).toBe(true);
    expect(isFailureResult({ exitCode: 3 })).toBe(true);
    expect(isFailureResult({ data: 1 })).toBe(false);
    expect(isFailureResult(undefined)).toBe(false);
  });
});

/**
 * `exitProcess: false` keeps process.exit() out of the test runner so the
 * resolved code can be asserted directly. tests/integration/exit-code.test.ts
 * proves the same mapping against a real child process.
 */
function makeCLI(commands: Record<string, any>) {
  return createCLI({
    name: 'run-exit-test',
    version: '0.0.0',
    exitProcess: false,
    plugins: { enabled: false },
    commands
  });
}

describe('run() exit code', () => {
  test('a returned success: false exits non-zero', async () => {
    const cli = makeCLI({
      create: {
        name: 'create',
        description: 'fails by returning',
        execute: () => ({ success: false, error: 'Requires permission' })
      }
    });

    expect(await cli.run(['create'])).toBe(1);
  });

  test('a normal data result exits 0', async () => {
    const cli = makeCLI({
      list: {
        name: 'list',
        description: 'succeeds',
        execute: () => ({ zones: ['a', 'b'] })
      }
    });

    expect(await cli.run(['list'])).toBe(0);
  });

  test('a void command exits 0', async () => {
    const cli = makeCLI({
      noop: {
        name: 'noop',
        description: 'returns nothing',
        execute: () => {}
      }
    });

    expect(await cli.run(['noop'])).toBe(0);
  });

  test('an explicit exitCode is honoured', async () => {
    const cli = makeCLI({
      pick: {
        name: 'pick',
        description: 'chooses its own code',
        execute: () => ({ success: false, exitCode: 42 })
      }
    });

    expect(await cli.run(['pick'])).toBe(42);
  });

  test('a thrown error exits non-zero', async () => {
    const cli = makeCLI({
      boom: {
        name: 'boom',
        description: 'throws',
        execute: () => {
          throw new Error('exploded');
        }
      }
    });

    expect(await cli.run(['boom'])).toBe(1);
  });

  test('failure survives a middleware chain', async () => {
    let sawCommand = false;

    const cli = createCLI({
      name: 'run-exit-middleware',
      version: '0.0.0',
      exitProcess: false,
      plugins: { enabled: false },
      middleware: [
        async (_context, _command, next) => {
          sawCommand = true;
          await next();
        }
      ],
      commands: {
        create: {
          name: 'create',
          description: 'fails by returning',
          execute: () => ({ success: false, error: 'nope' })
        }
      }
    });

    expect(await cli.run(['create'])).toBe(1);
    expect(sawCommand).toBe(true);
  });

  test('failure survives a subcommand', async () => {
    const cli = makeCLI({
      zone: {
        name: 'zone',
        description: 'zone commands',
        subcommands: {
          create: {
            name: 'create',
            description: 'fails by returning',
            execute: () => ({ success: false, error: 'nope' })
          }
        }
      }
    });

    expect(await cli.run(['zone', 'create'])).toBe(1);
  });

  test('an onError hook that does not exit still yields a non-zero code', async () => {
    let handled = false;

    const cli = createCLI({
      name: 'run-exit-onerror',
      version: '0.0.0',
      exitProcess: false,
      plugins: { enabled: false },
      onError: async () => {
        handled = true;
      },
      commands: {
        boom: {
          name: 'boom',
          description: 'throws',
          execute: () => {
            throw new Error('exploded');
          }
        }
      }
    });

    expect(await cli.run(['boom'])).toBe(1);
    expect(handled).toBe(true);
  });

  test('a defaultHandler failure exits non-zero', async () => {
    const cli = createCLI({
      name: 'run-exit-default',
      version: '0.0.0',
      exitProcess: false,
      plugins: { enabled: false },
      defaultHandler: () => ({ success: false, error: 'nope' }),
      commands: {}
    });

    expect(await cli.run(['not-a-command'])).toBe(1);
  });
});
