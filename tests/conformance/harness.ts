/**
 * Conformance harness.
 *
 * Every assertion in `tests/conformance/` runs against the BUILT artifact in a
 * real child process, never against `src/`. That distinction is the whole point
 * of this directory:
 *
 *   - A green source suite said nothing about the tarball. `"sideEffects": false`
 *     let bun tree-shake `core/cli.ts`, `commands/router.ts` and
 *     `core/exit-code.ts` out of `dist/index.js` while leaving their names in
 *     the export list. The build exited 0 and shipped a 65 KB stub.
 *   - Exit codes are only real as observed by a shell. A test that reads a
 *     return value inside the runner cannot see `process.exit(0)` firing on a
 *     failure.
 *
 * So: build once, then spawn `node` against `dist/index.js` and assert on
 * `proc.exited` and captured stdio.
 */
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DIST_ENTRY = join(REPO_ROOT, 'dist/index.js');

let buildPromise: Promise<void> | null = null;

/**
 * Build the package exactly as `npm publish` would, once per test process.
 *
 * Deliberately shells out to the package's own `build` script rather than
 * reimplementing the bun invocation. A conformance suite that builds with its
 * own flags proves nothing about what `prepublishOnly` produces.
 */
export function ensureBuilt(): Promise<void> {
  buildPromise ??= (async () => {
    const proc = Bun.spawn(['npm', 'run', 'build'], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe'
    });

    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

    if (code !== 0) {
      throw new Error(`build failed (exit ${code}):\n${stderr}`);
    }

    if (!existsSync(DIST_ENTRY)) {
      throw new Error(`build reported success but ${DIST_ENTRY} does not exist`);
    }
  })();

  return buildPromise;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Write an ESM script that imports the built bundle, run it under plain Node,
 * and report what a shell would see.
 *
 * Node rather than Bun on purpose: consumers run under Node, and Node is the
 * runtime that refused to import the tree-shaken stub. Bun would have papered
 * over it.
 */
export async function runScript(source: string, args: string[] = []): Promise<RunResult> {
  await ensureBuilt();

  const dir = mkdtempSync(join(tmpdir(), 'merlin-cli-conformance-'));
  const script = join(dir, 'entry.mjs');

  await Bun.write(script, source.replace(/__DIST__/g, JSON.stringify(DIST_ENTRY)));

  const proc = Bun.spawn(['node', script, ...args], {
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' }
  });

  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ]);

  return { code, stdout, stderr };
}

/**
 * Build a one-file CLI from a map of command name -> executor source text, run
 * it against the built bundle, and return what the shell observed.
 *
 * Executors arrive as source strings because they are serialised into a
 * separate process; a closure captured here would not survive the boundary.
 */
export async function runCLI(
  commands: Record<string, string>,
  args: string[],
  options: { config?: string } = {}
): Promise<RunResult> {
  const entries = Object.entries(commands)
    .map(
      ([name, body]) =>
        `  ${JSON.stringify(name)}: { name: ${JSON.stringify(name)}, description: 'conformance', execute: ${body} }`
    )
    .join(',\n');

  return runScript(
    `import { createCLI, LoggerToken, PrompterToken, createToken } from __DIST__;\n` +
      `const cli = createCLI({\n` +
      `  name: 'conformance', version: '0.0.0', plugins: { enabled: false },\n` +
      `  ${options.config ?? ''}\n` +
      `  commands: {\n${entries}\n  }\n` +
      `});\n` +
      // Echoed so a test can assert the value run() derived even in
      // exitProcess:false mode, where the process itself always exits 0.
      `const resolved = await cli.run();\n` +
      `console.log('[conformance:resolved] ' + resolved);\n`,
    args
  );
}

/** The exit code `run()` resolved with, as echoed by the harness script. */
export function resolvedCode(r: RunResult): number | null {
  const match = r.stdout.match(/\[conformance:resolved\] (\S+)/);
  return match ? Number(match[1]) : null;
}
