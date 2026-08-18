import { test, expect, describe, beforeAll } from 'bun:test';
import { ensureBuilt, runCLI, runScript, resolvedCode } from './harness.ts';

/**
 * The exit-code contract, asserted against the shipped bundle from a real
 * shell's point of view.
 *
 * Four defects in two days all lived here, and all four were the same species:
 * no test asserted the contract. A CLI that prints an error and exits 0 lies to
 * every caller above it — a CI gate, a `&&` chain, an agent reading `$?`.
 */
describe('exit codes (built artifact, real process)', () => {
  beforeAll(async () => {
    await ensureBuilt();
  }, 120_000);

  describe('success stays 0', () => {
    test('a command returning a plain data payload exits 0', async () => {
      const r = await runCLI({ ok: `() => ({ zones: ['a'], count: 1 })` }, ['ok']);
      expect(r.code).toBe(0);
    });

    test('a void command exits 0', async () => {
      const r = await runCLI({ ok: `() => { console.log('did the thing'); }` }, ['ok']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('did the thing');
    });

    test('an explicit success result exits 0', async () => {
      const r = await runCLI({ ok: `() => ({ success: true, message: 'done' })` }, ['ok']);
      expect(r.code).toBe(0);
    });

    test('primitive and array returns exit 0', async () => {
      expect((await runCLI({ s: `() => 'a string'` }, ['s'])).code).toBe(0);
      expect((await runCLI({ n: `() => 0` }, ['n'])).code).toBe(0);
      expect((await runCLI({ a: `() => [1, 2, 3]` }, ['a'])).code).toBe(0);
    });
  });

  describe('returned failure is a failure (defect #1)', () => {
    test('{ success: false } exits 1', async () => {
      const r = await runCLI({ fail: `() => ({ success: false, error: 'denied' })` }, ['fail']);
      expect(r.code).toBe(1);
    });

    test('an async returned failure exits 1', async () => {
      const r = await runCLI(
        { fail: `async () => { await new Promise(r => setTimeout(r, 1)); return { success: false }; }` },
        ['fail']
      );
      expect(r.code).toBe(1);
    });

    test('an explicit exitCode is honoured', async () => {
      const r = await runCLI({ fail: `() => ({ success: false, exitCode: 42 })` }, ['fail']);
      expect(r.code).toBe(42);
    });

    test('an exitCode without a success flag is honoured', async () => {
      const r = await runCLI({ fail: `() => ({ exitCode: 7 })` }, ['fail']);
      expect(r.code).toBe(7);
    });

    test('an out-of-range exitCode collapses to 1 rather than wrapping to 0', async () => {
      // process.exit(256) silently becomes 0 — the exact fail-open this closes.
      const r = await runCLI({ fail: `() => ({ exitCode: 256 })` }, ['fail']);
      expect(r.code).toBe(1);
    });

    test('stdout written before the failure still reaches the shell', async () => {
      // The exit must not truncate pending I/O; an error nobody can read is
      // barely better than an exit code nobody can read.
      const r = await runCLI(
        { fail: `() => { console.error('the reason it failed'); return { success: false }; }` },
        ['fail']
      );
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('the reason it failed');
    });
  });

  describe('thrown errors exit non-zero', () => {
    test('a synchronous throw exits 1', async () => {
      const r = await runCLI({ boom: `() => { throw new Error('exploded'); }` }, ['boom']);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('exploded');
    });

    test('an async rejection exits 1', async () => {
      const r = await runCLI({ boom: `async () => { throw new Error('async explosion'); }` }, ['boom']);
      expect(r.code).toBe(1);
    });

    test('an unknown command exits 1', async () => {
      const r = await runCLI({ ok: `() => {}` }, ['no-such-command']);
      expect(r.code).toBe(1);
    });

    test('an onError hook that swallows the error still exits 1', async () => {
      // A consumed error is still a failed command. Reporting success because
      // the hook handled it is the same fail-open in a different costume.
      const r = await runCLI({ boom: `() => { throw new Error('handled'); }` }, ['boom'], {
        config: `onError: async () => { console.error('hook saw it'); },`
      });
      expect(r.stderr).toContain('hook saw it');
      expect(r.code).toBe(1);
    });
  });

  describe('logger.error + bare return cannot exit 0 (defect #3)', () => {
    // The 1.1.0 fix reads the command's RETURN VALUE, so it is blind to the
    // shape `logger.error(...); return;` — which cf-cli had in 16 places
    // across five command files. The framework has to see the error itself.

    test('logger.error followed by a bare return exits 1', async () => {
      const r = await runCLI(
        {
          fail: `(ctx) => {
            const logger = ctx.registry.get(LoggerToken);
            logger.error('Zone not found');
            return;
          }`
        },
        ['fail'],
        { config: `` }
      );
      expect(r.stderr).toContain('Zone not found');
      expect(r.code).toBe(1);
    });

    test('logger.error followed by a plain data return exits 1', async () => {
      const r = await runCLI(
        {
          fail: `(ctx) => {
            ctx.registry.get(LoggerToken).error('partial failure');
            return { rows: [] };
          }`
        },
        ['fail']
      );
      expect(r.code).toBe(1);
    });

    test('logger.warn does not fail the command', async () => {
      const r = await runCLI(
        { ok: `(ctx) => { ctx.registry.get(LoggerToken).warn('deprecated flag'); }` },
        ['ok']
      );
      expect(r.code).toBe(0);
    });

    test('an explicit success result does not override a logged error', async () => {
      // If a command logged an error, it failed. `success: true` alongside it
      // is a contradiction, and the safe reading of a contradiction is failure.
      const r = await runCLI(
        {
          fail: `(ctx) => { ctx.registry.get(LoggerToken).error('boom'); return { success: true }; }`
        },
        ['fail']
      );
      expect(r.code).toBe(1);
    });

    test('a consumer-supplied logger is still counted', async () => {
      // The common real-world shape, and the one that nearly made this whole
      // feature a no-op: the consumer builds its own logger and registers it
      // on the same 'logger' key from cli.bootstrap, replacing ours. Four
      // repos in the estate do this. If registration is not intercepted, the
      // policy reads a null count, treats it as zero, and silently never fires.
      const r = await runScript(
        `import { createCLI, LoggerToken } from __DIST__;\n` +
          `const cli = createCLI({ name: 'p', version: '0', exitProcess: false, commands: {\n` +
          `  f: { name: 'f', description: 'd', execute: (ctx) => { ctx.registry.get(LoggerToken).error('it failed'); return; } }\n` +
          `} });\n` +
          `cli.bootstrap = async (registry) => {\n` +
          `  registry.register(LoggerToken, {\n` +
          `    info: console.log, error: console.error, warn: console.warn,\n` +
          `    debug: () => {}, success: console.log, log: () => {}\n` +
          `  });\n` +
          `};\n` +
          `console.log('[conformance:resolved] ' + (await cli.run(['f'])));\n`
      );

      expect(r.stderr).toContain('it failed');
      expect(resolvedCode(r)).toBe(1);
    });

    test('a consumer-supplied logger keeps its own behaviour when wrapped', async () => {
      // The wrapper must be invisible: custom methods, extra properties and
      // `this` all survive, or we would be fixing one defect by adding another.
      const r = await runScript(
        `import { createCLI, LoggerToken } from __DIST__;\n` +
          `const cli = createCLI({ name: 'p', version: '0', exitProcess: false, commands: {\n` +
          `  f: { name: 'f', description: 'd', execute: (ctx) => {\n` +
          `    const l = ctx.registry.get(LoggerToken);\n` +
          `    l.audit('custom method works');\n` +
          `    l.info('plain info');\n` +
          `    if (l.tag !== 'mine') throw new Error('property lost');\n` +
          `  } }\n` +
          `} });\n` +
          `cli.bootstrap = async (registry) => {\n` +
          `  registry.register(LoggerToken, {\n` +
          `    tag: 'mine',\n` +
          `    info: (m) => console.log('custom:' + m),\n` +
          `    error: console.error, warn: () => {}, debug: () => {},\n` +
          `    success: () => {}, log: () => {},\n` +
          `    audit(m) { console.log('audit:' + m + ':' + this.tag); }\n` +
          `  });\n` +
          `};\n` +
          `console.log('[conformance:resolved] ' + (await cli.run(['f'])));\n`
      );

      expect(r.stdout).toContain('audit:custom method works:mine');
      expect(r.stdout).toContain('custom:plain info');
      expect(resolvedCode(r)).toBe(0);
    });

    test('errorExitPolicy: "off" restores the permissive behaviour', async () => {
      // Escape hatch for a consumer that genuinely reports non-fatal errors.
      // Opt-out, never default: fail-closed is the safe direction.
      const r = await runCLI(
        { ok: `(ctx) => { ctx.registry.get(LoggerToken).error('non-fatal'); }` },
        ['ok'],
        { config: `errorExitPolicy: 'off',` }
      );
      expect(r.stderr).toContain('non-fatal');
      expect(r.code).toBe(0);
    });
  });

  describe('run() resolves the code it derived', () => {
    test('with exitProcess:false the caller observes the code without exiting', async () => {
      const r = await runCLI({ fail: `() => ({ success: false })` }, ['fail'], {
        config: `exitProcess: false,`
      });
      expect(r.code).toBe(0); // the harness script itself does not exit
      expect(resolvedCode(r)).toBe(1); // but run() still reported the failure
    });

    test('with exitProcess:false a success still resolves 0', async () => {
      const r = await runCLI({ ok: `() => ({ success: true })` }, ['ok'], {
        config: `exitProcess: false,`
      });
      expect(resolvedCode(r)).toBe(0);
    });
  });
});
