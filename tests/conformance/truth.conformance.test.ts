import { expect, describe, beforeAll } from 'bun:test';
import { T, runScript, ensurePacked } from './harness.ts';
import { FIXTURE } from './fixtures.ts';

const run = (args: string[], options = {}) => runScript(FIXTURE, args, options);

describe('TRUTH — the exit code', () => {
  beforeAll(async () => { await ensurePacked(); }, 180_000);

  T('TRUTH-1', 'a command returning data exits 0', async () => {
    const r = await run(['ok', 'world']);
    expect(r.code).toBe(0);
  });

  T('TRUTH-1', 'a command returning nothing exits 0', async () => {
    expect((await run(['silent'])).code).toBe(0);
  });

  T('TRUTH-1', 'returning { success: false } exits 1', async () => {
    expect((await run(['returned-false'])).code).toBe(1);
  });

  T('TRUTH-1', 'returning { exitCode: n } exits n', async () => {
    expect((await run(['coded', '--code', '4'])).code).toBe(4);
  });

  T('TRUTH-1', 'throwing exits 1', async () => {
    const r = await run(['thrower']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('exploded');
  });

  T('TRUTH-1', 'reporting an error on the logger exits 1 even when nothing is returned', async () => {
    // The shape this framework exists for: `logger.error(...); return;` reads as
    // a handled failure to a person and as success to everything else.
    const r = await run(['reported']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('zone not found');
  });

  T('TRUTH-2', 'an out-of-range exit code collapses to 1 rather than wrapping to 0', async () => {
    // process.exit(256) reports 0 to the shell.
    expect((await run(['coded', '--code', '256'])).code).toBe(1);
    expect((await run(['coded', '--code', '-1'])).code).toBe(1);
  });

  T('TRUTH-3', 'the rule applies to a logger the consumer registers later', async () => {
    const r = await runScript(
      `import { createCLI, createToken, LoggerToken } from __DIST__;\n` +
        `const own = createToken('logger');\n` +
        `const cli = createCLI({ name: 'byo', version: '0.0.0', commands: {\n` +
        `  boom: { name: 'boom', description: 'd', execute: ({ registry }) => { registry.get(LoggerToken).error('mine'); } }\n` +
        `} });\n` +
        // Registered from bootstrap, on a colliding key, after createCLI returned
        // — which is what four repos in the estate actually do.
        `cli.bootstrap = async (registry) => { registry.register(own, {\n` +
        `  info: (m) => console.error(m), error: (m) => console.error('E ' + m),\n` +
        `  warn: () => {}, debug: () => {}, success: () => {}, log: () => {}\n` +
        `}); };\n` +
        `await cli.run();\n`,
      ['boom']
    );

    expect(r.code).toBe(1);
    expect(r.stderr).toContain('E mine');
  });

  T('TRUTH-3', 'a consumer logger keeps its own methods and properties', async () => {
    const r = await runScript(
      `import { createCLI, LoggerToken } from __DIST__;\n` +
        `class Chatty {\n` +
        `  constructor() { this.tag = 'kept'; }\n` +
        `  info(m) { console.error(this.tag + ':' + m); }\n` +
        `  error(m) { console.error('E'); }\n` +
        `  warn() {} debug() {} success() {} log() {}\n` +
        `  custom() { return this.tag; }\n` +
        `}\n` +
        `const cli = createCLI({ name: 'byo', version: '0.0.0', commands: {\n` +
        `  go: { name: 'go', description: 'd', execute: ({ registry }) => {\n` +
        `    const l = registry.get(LoggerToken);\n` +
        `    l.info('hi');\n` +
        `    console.error('custom=' + l.custom());\n` +
        `    console.error('tag=' + l.tag);\n` +
        `  } }\n` +
        `} });\n` +
        `cli.bootstrap = async (registry) => { registry.register(LoggerToken, new Chatty()); };\n` +
        `await cli.run();\n`,
      ['go']
    );

    expect(r.code).toBe(0);
    expect(r.stderr).toContain('kept:hi');
    expect(r.stderr).toContain('custom=kept');
    expect(r.stderr).toContain('tag=kept');
  });

  T('TRUTH-3', "errorExitPolicy 'off' opts the whole CLI out", async () => {
    const r = await runScript(
      `import { createCLI, LoggerToken } from __DIST__;\n` +
        `const cli = createCLI({ name: 'lenient', version: '0.0.0', errorExitPolicy: 'off', commands: {\n` +
        `  warnish: { name: 'warnish', description: 'd', execute: ({ registry }) => { registry.get(LoggerToken).error('non-fatal'); } }\n` +
        `} });\n` +
        `await cli.run();\n`,
      ['warnish']
    );

    expect(r.code).toBe(0);
  });

  T('TRUTH-4', 'ok, code and the process status are the same fact', async () => {
    const success = await run(['ok', 'world', '--json']);
    expect(success.code).toBe(0);
    expect(success.json().ok).toBe(true);
    expect(success.json().code).toBe(0);

    const failure = await run(['returned-false', '--json']);
    expect(failure.code).toBe(1);
    expect(failure.json().ok).toBe(false);
    expect(failure.json().code).toBe(1);

    const coded = await run(['coded', '--code', '7', '--json']);
    expect(coded.code).toBe(7);
    expect(coded.json().code).toBe(7);
    expect(coded.json().ok).toBe(false);
  });

  T('TRUTH-5', 'an onError hook cannot turn a failure into a success', async () => {
    const r = await runScript(
      `import { createCLI } from __DIST__;\n` +
        `const cli = createCLI({ name: 'hooked', version: '0.0.0',\n` +
        `  onError: async () => { console.error('handled'); },\n` +
        `  commands: { boom: { name: 'boom', description: 'd', execute: () => { throw new Error('nope'); } } }\n` +
        `});\n` +
        `await cli.run();\n`,
      ['boom']
    );

    expect(r.stderr).toContain('handled');
    expect(r.code).toBe(1);
  });
});

describe('EXIT — usage errors are their own kind', () => {
  beforeAll(async () => { await ensurePacked(); }, 180_000);

  T('EXIT-1', 'an unknown command exits 2', async () => {
    const r = await run(['no-such-command']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Unknown command');
  });

  T('EXIT-1', 'an unknown subcommand exits 2 and lists the real ones', async () => {
    const r = await run(['group', 'nope']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('inner');
  });

  T('EXIT-2', 'calling wrong (2) is distinguishable from failing (1)', async () => {
    expect((await run(['ok'])).code).toBe(2);
    expect((await run(['returned-false'])).code).toBe(1);
  });

  T('EXIT-3', 'an application code in 3-125 passes through', async () => {
    expect((await run(['coded', '--code', '3'])).code).toBe(3);
    expect((await run(['coded', '--code', '125'])).code).toBe(125);
  });

  T('EXIT-3', 'declared exit codes reach the manifest', async () => {
    const manifest = (await run(['manifest'])).json();
    const ok = manifest.commands.find((c: any) => c.name === 'ok');
    expect(ok.exitCodes).toEqual([{ code: 4, meaning: 'partial' }]);
  });
});
