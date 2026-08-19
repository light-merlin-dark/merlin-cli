import { test, expect, describe, beforeAll } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ensureBuilt, ensurePacked, runScript, REPO_ROOT, DIST_ENTRY } from './harness.ts';

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
    await ensurePacked();
  }, 180_000);

  test('sideEffects is not false', () => {
    // The specific flag that caused it. Kept as a named regression guard so a
    // future "bundle size optimisation" has to argue with a test.
    expect(pkg.sideEffects).not.toBe(false);
  });

  test('there are no runtime dependencies', () => {
    // Every dependency is a decade of someone else's release decisions. The
    // two this package had — picocolors and prompts — are now ~60 and ~120
    // lines of first-party code.
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  test('the package runs no install scripts', () => {
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
      expect(pkg.scripts?.[hook]).toBeUndefined();
    }
  });

  test('the bundle contains the whole framework, not a stub', () => {
    // Size alone is a weak signal, so this also looks for a fingerprint from
    // each module that was elided the first time.
    const bundle = readFileSync(DIST_ENTRY, 'utf8');

    for (const fingerprint of [
      'Unknown command',           // router
      'merlin-cli/manifest/v2',    // manifest
      'errorCount',                // logger instrumentation
      'Unknown option',            // grammar
      'contract'                   // envelope
    ]) {
      expect(bundle).toContain(fingerprint);
    }

    expect(statSync(DIST_ENTRY).size).toBeGreaterThan(60_000);
  });

  test('every entry point in package.json exists on disk', () => {
    for (const path of [pkg.main, pkg.types].filter(Boolean)) {
      expect(() => statSync(join(REPO_ROOT, path))).not.toThrow();
    }
  });

  test('every path the exports map promises actually exists', () => {
    // `exports` claimed a CommonJS build at ./dist/index.cjs that the build
    // script never produced, so `require()` of this package threw
    // ERR_MODULE_NOT_FOUND. Same species as the tree-shaken stub: a declared
    // surface the artifact does not have, and nothing checked.
    const promised: string[] = [];

    const walk = (node: unknown) => {
      if (typeof node === 'string') {
        if (node.startsWith('./')) promised.push(node);
      } else if (node && typeof node === 'object') {
        Object.values(node).forEach(walk);
      }
    };
    walk(pkg.exports);

    expect(promised.length).toBeGreaterThan(0);
    for (const rel of promised) {
      expect(() => statSync(join(REPO_ROOT, rel))).not.toThrow();
    }
  });

  test('no dependency is declared without being used', () => {
    // `valibot` sat in dependencies with zero imports — and the README
    // advertised it. A public package should not make every consumer install
    // something it never loads.
    const imported = Bun.spawnSync(['git', 'grep', '-hoE', "from '[^.'][^']*'", '--', 'src'], {
      cwd: REPO_ROOT
    })
      .stdout.toString()
      .split('\n')
      .map(line => line.replace(/^from '|'$/g, '').trim())
      .filter(Boolean)
      .map(name => (name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]));

    const used = new Set(imported);
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      expect(used.has(dep)).toBe(true);
    }
  });

  test('the framework imports only the runtime API intersection', () => {
    // Node, Bun and Deno agree on `node:` builtins and globals. A runtime-
    // specific code path would be a defect, not a feature.
    const imported = Bun.spawnSync(['git', 'grep', '-hoE', "from '[^.'][^']*'", '--', 'src'], {
      cwd: REPO_ROOT
    })
      .stdout.toString()
      .split('\n')
      .map(line => line.replace(/^from '|'$/g, '').trim())
      .filter(Boolean);

    for (const specifier of imported) {
      expect(specifier.startsWith('node:')).toBe(true);
    }
  });

  test('the contract and the migration guide ship with the package', async () => {
    // A promise a consumer cannot read is not much of a promise — and a
    // migration guide is only useful where the migration happens, which is in
    // the consumer's own repository, in its node_modules.
    const entry = await ensurePacked();
    const root = dirname(dirname(entry));

    for (const doc of ['CONTRACT.md', 'MIGRATING.md']) {
      expect(pkg.files).toContain(doc);
      expect(() => statSync(join(root, doc))).not.toThrow();
    }
  });

  test('the bundle imports cleanly under plain Node', async () => {
    // Node is what refused the stub; Bun imported it happily. Consumers run
    // under Node, so Node is the runtime that gets to vote.
    const r = await runScript(`import * as m from __DIST__;\nconsole.log(Object.keys(m).length);\n`);

    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(Number(r.stdout.trim())).toBeGreaterThan(40);
  });

  test('the packed tarball carries a working framework under Bun as well', async () => {
    // LONG-2: the same artifact, the other runtime.
    const r = await runScript(
      `import { createCLI } from __DIST__;\n` +
        `await createCLI({ name: 'packed', version: '0.0.0', commands: {\n` +
        `  fail: { name: 'fail', description: 'd', execute: () => ({ success: false }) }\n` +
        `} }).run();\n`,
      ['fail'],
      { runtime: 'bun' }
    );

    expect(r.code).toBe(1);
  }, 180_000);

  test('the packed tarball carries a working framework under Deno as well', async () => {
    // Runtime neutrality is a claim the README makes, so it is checked rather
    // than assumed. Deno has no `setImmediate`; relying on one was the defect
    // this test now guards.
    // Skip where Deno is absent rather than failing: `spawnSync` throws on a
    // missing binary, it does not report an unsuccessful exit.
    try {
      const available = Bun.spawnSync(['deno', '--version'], { stdout: 'pipe', stderr: 'pipe' });
      if (!available.success) return;
    } catch {
      return;
    }

    const r = await runScript(
      `import { createCLI } from __DIST__;\n` +
        `await createCLI({ name: 'packed', version: '0.0.0', commands: {\n` +
        `  ok: { name: 'ok', description: 'd', execute: () => ({ fine: true }) },\n` +
        `  fail: { name: 'fail', description: 'd', execute: () => ({ success: false }) }\n` +
        `} }).run();\n`,
      ['ok', '--json'],
      { runtime: 'deno', denoArgs: ['run', '--allow-read', '--allow-env', '--allow-sys'] }
    );

    expect(r.code).toBe(0);
    expect(r.json().ok).toBe(true);
  }, 180_000);

  test('the build is reproducible from a clean tree', async () => {
    const first = readFileSync(DIST_ENTRY);
    await ensureBuilt();
    expect(readFileSync(DIST_ENTRY).equals(first)).toBe(true);
  }, 180_000);
});
