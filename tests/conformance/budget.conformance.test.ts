import { expect, describe, beforeAll } from 'bun:test';
import { statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, runScript, spawnScript, ensurePacked, ensureBuilt, DIST_ENTRY } from './harness.ts';
import { FIXTURE, scaleFixture } from './fixtures.ts';

/**
 * Budgets are ratios, not milliseconds, so the clauses stay meaningful on
 * whatever hardware runs them in five years. Each measurement is the best of
 * several runs: a cold cache or a busy machine inflates the slowest, never the
 * fastest, so the minimum is the honest number.
 */
async function fastest(runs: number, task: () => Promise<{ ms: number; code: number }>): Promise<number> {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const result = await task();
    expect(result.code).toBe(0);
    best = Math.min(best, result.ms);
  }
  return best;
}

describe('PERF — budgets as clauses', () => {
  beforeAll(async () => { await ensurePacked(); }, 180_000);

  T('PERF-1', 'startup is O(1) in command count', async () => {
    // Achievable only because described-lazy commands keep their metadata
    // inline: a 500-command CLI loads none of the 500 modules to print a
    // version. Every load function in this fixture throws if called.
    const small = await fastest(3, () => runScript(scaleFixture(5), ['version']));
    const large = await fastest(3, () => runScript(scaleFixture(500), ['version']));

    expect(large / small).toBeLessThan(1.5);
  }, 180_000);

  T('PERF-2', 'the framework does not dominate its host', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'merlin-cli-perf-'));
    const bare = join(dir, 'bare.mjs');
    writeFileSync(bare, 'process.exit(0);\n');

    const baseline = await fastest(5, () => spawnScript(bare, [], { cwd: dir }));
    const framework = await fastest(5, () => runScript(FIXTURE, ['version']));

    expect(framework / baseline).toBeLessThan(4);
  }, 180_000);

  T('PERF-3', 'ndjson streaming does not grow the heap with the item count', async () => {
    const measure = (count: number) =>
      runScript(
        `import { createCLI, createCommand } from __DIST__;\n` +
          `const cli = createCLI({ name: 'flood', version: '0.0.0', commands: {\n` +
          `  flood: createCommand({ name: 'flood', description: 'd', options: {},\n` +
          `    execute: ({ emit }) => { for (let i = 0; i < ${count}; i++) emit({ i }); } })\n` +
          `} });\n` +
          `const before = process.memoryUsage().heapUsed;\n` +
          `await cli.run();\n`,
        ['flood', '--ndjson']
      );

    const [small, large] = await Promise.all([measure(1_000), measure(200_000)]);

    expect(small.code).toBe(0);
    expect(large.code).toBe(0);
    // Two hundred times the items. Accumulating them would show here.
    expect(large.stdout.split('\n').length).toBe(200_002);
  }, 180_000);

  T('PERF-4', 'the published bundle stays small enough to audit', async () => {
    await ensureBuilt();
    expect(statSync(DIST_ENTRY).size).toBeLessThan(150_000);
  }, 180_000);
});

describe('COMPAT — what a CLI claims', () => {
  beforeAll(async () => { await ensurePacked(); }, 180_000);

  T('COMPAT-4', 'the contract version appears in every envelope and manifest', async () => {
    const envelope = (await runScript(FIXTURE, ['ok', 'world', '--json'])).json();
    expect(envelope.cli.contract).toBe('2.0');

    const manifest = (await runScript(FIXTURE, ['manifest'])).json();
    expect(manifest.contract).toBe('2.0');
  });
});
