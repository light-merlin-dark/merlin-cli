import { test, expect, describe } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ENTRY = join(REPO_ROOT, 'src/index.ts');

/**
 * `bun build` will happily report success while tree-shaking the entire
 * framework out of the bundle and leaving the names behind in the export list.
 * That happened: `"sideEffects": false` produced an 18-module, 65 KB
 * `dist/index.js` that Node refused to import — and the build exited 0.
 *
 * These assert the shipped artifact, not the source. A green source test suite
 * says nothing about what actually lands in the tarball.
 */
describe('build artifact', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'merlin-cli-build-'));

  test('the bundle builds', async () => {
    const proc = Bun.spawn(['bun', 'build', ENTRY, '--target', 'node', '--outdir', outDir], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe'
    });

    expect(await proc.exited).toBe(0);
  });

  test('the bundle is importable and defines its exports', async () => {
    const bundle = await import(join(outDir, 'index.js'));

    // Named here because these are the five symbols every consumer in the
    // estate imports. If tree-shaking eats them the package is dead on arrival.
    expect(typeof bundle.createCLI).toBe('function');
    expect(typeof bundle.createToken).toBe('function');
    expect(typeof bundle.ServiceRegistry).toBe('function');
    expect(bundle.LoggerToken).toBeDefined();
    expect(bundle.PrompterToken).toBeDefined();

    expect(typeof bundle.CommandRouter).toBe('function');
    expect(typeof bundle.resolveExitCode).toBe('function');
  });

  test('the built bundle exits non-zero on a returned failure', async () => {
    const script = join(outDir, 'exit-proof.mjs');

    await Bun.write(
      script,
      `import { createCLI } from ${JSON.stringify(join(outDir, 'index.js'))};\n` +
        `const cli = createCLI({ name: 'p', version: '0', plugins: { enabled: false }, commands: {\n` +
        `  fail: { name: 'fail', description: 'd', execute: () => ({ success: false, error: 'denied' }) },\n` +
        `  ok: { name: 'ok', description: 'd', execute: () => ({ zones: [] }) }\n` +
        `} });\nawait cli.run();\n`
    );

    const fail = Bun.spawn(['node', script, 'fail'], { stdout: 'pipe', stderr: 'pipe' });
    const ok = Bun.spawn(['node', script, 'ok'], { stdout: 'pipe', stderr: 'pipe' });

    expect(await fail.exited).toBe(1);
    expect(await ok.exited).toBe(0);
  });
});
