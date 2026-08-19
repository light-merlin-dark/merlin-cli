import { expect, describe, beforeAll } from 'bun:test';
import { T, runScript, ensurePacked } from './harness.ts';
import { FIXTURE } from './fixtures.ts';

const run = (args: string[], options = {}) => runScript(FIXTURE, args, options);

describe('HANG — a prompt never blocks a caller that cannot answer', () => {
  beforeAll(async () => { await ensurePacked(); }, 180_000);

  T('HANG-1', 'a prompt with no terminal fails immediately with exit 2', async () => {
    const started = performance.now();
    const r = await run(['asks'], { timeoutMs: 5_000 });

    expect(r.code).toBe(2);
    expect(performance.now() - started).toBeLessThan(4_000);
  });

  T('HANG-1', 'the message names the question', async () => {
    const r = await run(['asks'], { timeoutMs: 5_000 });
    expect(r.stderr).toContain('Proceed?');
  });

  T('HANG-1', 'a declared fallback flag is named in the message', async () => {
    const r = await runScript(
      `import { createCLI, createPrompter, PrompterToken } from __DIST__;\n` +
        `const cli = createCLI({ name: 'gated', version: '0.0.0', commands: {\n` +
        `  go: { name: 'go', description: 'd', execute: async ({ registry }) =>\n` +
        `    ({ yes: await registry.get(PrompterToken).confirm('Delete production?') }) }\n` +
        `} });\n` +
        `cli.bootstrap = async (r) => { r.register(PrompterToken, createPrompter({ fallbackFlag: '--yes' })); };\n` +
        `await cli.run();\n`,
      ['go'],
      { timeoutMs: 5_000 }
    );

    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--yes');
  });

  T('HANG-1', 'piping stdin does not silently answer a prompt', async () => {
    const r = await run(['asks'], { stdin: 'y\n', timeoutMs: 5_000 });
    expect(r.code).toBe(2);
  });

  T('HANG-2', 'machine mode is non-interactive by definition', async () => {
    const r = await run(['asks', '--json'], { timeoutMs: 5_000 });

    expect(r.code).toBe(2);
    expect(r.json().ok).toBe(false);
    expect(r.json().error.message).toContain('Proceed?');
  });

  T('HANG-3', 'a stray timer does not keep a finished CLI alive', async () => {
    const started = performance.now();
    const r = await run(['lingers'], { timeoutMs: 10_000 });

    expect(r.code).toBe(0);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

describe('CANCEL — Ctrl-C is an API', () => {
  beforeAll(async () => { await ensurePacked(); }, 180_000);

  T('CANCEL-1', 'the command sees the abort and can clean up', async () => {
    // `sleeps` waits five seconds unless its abort listener fires.
    const r = await run(['sleeps'], { signal: 'SIGINT', signalAfterMs: 400, timeoutMs: 10_000 });
    expect(r.ms).toBeLessThan(4_000);
  });

  T('CANCEL-2', 'SIGINT exits 130 even though the command returned normally', async () => {
    // A cleanup handler that swallows the abort must not be able to report
    // success for a run the caller killed.
    const r = await run(['sleeps'], { signal: 'SIGINT', signalAfterMs: 400, timeoutMs: 10_000 });
    expect(r.code).toBe(130);
  });

  T('CANCEL-2', 'SIGTERM exits 143', async () => {
    const r = await run(['sleeps'], { signal: 'SIGTERM', signalAfterMs: 400, timeoutMs: 10_000 });
    expect(r.code).toBe(143);
  });

  T('CANCEL-2', 'a command that ignores the abort is still ended by the grace period', async () => {
    const r = await runScript(
      `import { createCLI } from __DIST__;\n` +
        `const cli = createCLI({ name: 'stubborn', version: '0.0.0', gracePeriodMs: 300, commands: {\n` +
        // A timer stands in for the network call a real command would be inside;
        // it also keeps the loop alive, which is what makes the grace period the
        // thing that ends the process.
        `  hold: { name: 'hold', description: 'd', execute: () => new Promise(() => { setInterval(() => {}, 50); }) }\n` +
        `} });\n` +
        `await cli.run();\n`,
      ['hold'],
      { signal: 'SIGINT', signalAfterMs: 300, timeoutMs: 10_000 }
    );

    expect(r.code).toBe(130);
    expect(r.ms).toBeLessThan(5_000);
  });

  T('CANCEL-3', 'an interrupted machine-mode run still emits its envelope', async () => {
    const r = await run(['sleeps', '--ndjson'], {
      signal: 'SIGINT',
      signalAfterMs: 400,
      timeoutMs: 10_000
    });

    expect(r.code).toBe(130);
    expect(r.json().code).toBe(130);
    expect(r.json().ok).toBe(false);
  });
});
