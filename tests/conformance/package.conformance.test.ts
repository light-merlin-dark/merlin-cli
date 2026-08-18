import { test, expect, describe, beforeAll } from 'bun:test';
import { readFileSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureBuilt, runScript, REPO_ROOT, DIST_ENTRY } from './harness.ts';

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));

/**
 * What actually lands in the tarball.
 *
 * `"sideEffects": false` let bun tree-shake `core/cli.ts`, `commands/router.ts`
 * and `core/exit-code.ts` out of the bundle while leaving their names in the
 * export list. `bun build` printed "Bundled 18 modules" of 33 and exited 0. The
 * result was a 65 KB stub that would have taken every consumer down.
 *
 * The lesson generalises past that one flag: a build that exits 0 is not
 * evidence, and neither is a green source suite. Only the artifact is.
 */
describe('packaging', () => {
  beforeAll(async () => {
    await ensureBuilt();
  }, 120_000);

  test('sideEffects is not false', async () => {
    // The specific flag that caused it. Kept as a named regression guard so a
    // future "bundle size optimisation" has to argue with a test.
    expect(pkg.sideEffects).not.toBe(false);
  });

  test('the bundle contains the whole framework, not a stub', async () => {
    const bytes = statSync(DIST_ENTRY).size;

    // The stub was 65 KB; a complete bundle is several times that. This is a
    // floor, not a size budget — it only has to catch catastrophic elision.
    expect(bytes).toBeGreaterThan(120_000);
  });

  test('every entry point in package.json exists on disk', async () => {
    for (const path of [pkg.main, pkg.types].filter(Boolean)) {
      expect(() => statSync(join(REPO_ROOT, path))).not.toThrow();
    }
  });

  test('the bundle imports cleanly under plain Node', async () => {
    // Node is what refused the stub; Bun imported it happily. Consumers run
    // under Node, so Node is the runtime that gets to vote.
    const r = await runScript(`import * as m from __DIST__;\nconsole.log(Object.keys(m).length);\n`);

    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(Number(r.stdout.trim())).toBeGreaterThan(10);
  });

  test('the packed tarball carries a working framework', async () => {
    // The end of the chain: pack exactly what publish would, unpack it, and
    // import it the way a consumer's node_modules would. Defect #4 was that
    // nothing between a green suite and a live install ever did this.
    const dir = mkdtempSync(join(tmpdir(), 'merlin-cli-pack-'));

    const pack = Bun.spawn(['npm', 'pack', '--pack-destination', dir], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe'
    });
    expect(await pack.exited).toBe(0);

    const tarball = (await new Response(pack.stdout).text()).trim().split('\n').pop()!;

    const untar = Bun.spawn(['tar', '-xzf', join(dir, tarball), '-C', dir], {
      stdout: 'pipe',
      stderr: 'pipe'
    });
    expect(await untar.exited).toBe(0);

    const packedEntry = join(dir, 'package', pkg.main);
    const r = await runScript(
      `import { createCLI, createCommand, createToken, LoggerToken, PrompterToken } from ${JSON.stringify(packedEntry)};\n` +
        `const cli = createCLI({ name: 'packed', version: '0.0.0', plugins: { enabled: false }, commands: {\n` +
        `  fail: { name: 'fail', description: 'd', execute: () => ({ success: false }) }\n` +
        `} });\n` +
        `await cli.run();\n`,
      ['fail']
    );

    // Imported from the tarball, and the exit-code contract still holds there.
    expect(r.code).toBe(1);
  }, 180_000);
});
