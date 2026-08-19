/**
 * Conformance harness.
 *
 * Every assertion in `tests/conformance/` runs against the PACKED artifact in a
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
 * So: build, `npm pack`, unpack, then spawn `node` against the unpacked
 * package's entry point and assert on the exit status and the captured bytes.
 */
import { test } from 'bun:test';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DIST_ENTRY = join(REPO_ROOT, 'dist/index.js');

let buildPromise: Promise<void> | null = null;
let packPromise: Promise<string> | null = null;

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

    if (code !== 0) throw new Error(`build failed (exit ${code}):\n${stderr}`);
    if (!existsSync(DIST_ENTRY)) {
      throw new Error(`build reported success but ${DIST_ENTRY} does not exist`);
    }
  })();

  return buildPromise;
}

/** Pack the tarball, unpack it, and return the entry point a consumer would load. */
export function ensurePacked(): Promise<string> {
  packPromise ??= (async () => {
    await ensureBuilt();

    const dir = mkdtempSync(join(tmpdir(), 'merlin-cli-packed-'));
    const pack = Bun.spawn(['npm', 'pack', '--pack-destination', dir], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe'
    });

    const [packCode, packOut, packErr] = await Promise.all([
      pack.exited,
      new Response(pack.stdout).text(),
      new Response(pack.stderr).text()
    ]);
    if (packCode !== 0) throw new Error(`npm pack failed (exit ${packCode}):\n${packErr}`);

    const tarball = packOut.trim().split('\n').pop()!;
    const untar = Bun.spawn(['tar', '-xzf', join(dir, tarball), '-C', dir], {
      stdout: 'pipe',
      stderr: 'pipe'
    });
    if ((await untar.exited) !== 0) throw new Error('tar extraction failed');

    const pkg = JSON.parse(await Bun.file(join(REPO_ROOT, 'package.json')).text());
    const entry = join(dir, 'package', pkg.main);
    if (!existsSync(entry)) throw new Error(`packed tarball has no ${pkg.main}`);

    return entry;
  })();

  return packPromise;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Milliseconds of wall clock, for the PERF clauses. */
  ms: number;
  json(): any;
  items(): any[];
  events(): Array<Record<string, any>>;
}

function decorate(code: number, stdout: string, stderr: string, ms: number): RunResult {
  return {
    code,
    stdout,
    stderr,
    ms,
    json() {
      const lines = stdout.trim().split('\n');
      return JSON.parse(stdout.trim().startsWith('{\n') ? stdout.trim() : lines[lines.length - 1]);
    },
    items() {
      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line))
        .filter(entry => !(entry && typeof entry === 'object' && 'cli' in entry && 'ok' in entry));
    },
    events() {
      return stderr
        .trim()
        .split('\n')
        .filter(line => line.startsWith('{'))
        .map(line => JSON.parse(line));
    }
  };
}

export interface SpawnOptions {
  env?: Record<string, string | undefined>;
  /** Arguments the runtime needs before the script path, e.g. Deno's grants. */
  denoArgs?: string[];
  stdin?: string;
  timeoutMs?: number;
  signal?: NodeJS.Signals;
  signalAfterMs?: number;
  runtime?: string;
}

/**
 * Write an ESM script that imports the packed package, run it under plain Node,
 * and report what a shell would see.
 *
 * Node rather than Bun by default: consumers run under Node, and Node is the
 * runtime that refused to import the tree-shaken stub.
 */
export async function runScript(
  source: string,
  args: string[] = [],
  options: SpawnOptions = {}
): Promise<RunResult> {
  const entry = await ensurePacked();

  const dir = mkdtempSync(join(tmpdir(), 'merlin-cli-conformance-'));
  const script = join(dir, 'entry.mjs');
  writeFileSync(script, source.replace(/__DIST__/g, JSON.stringify(entry)));

  return spawnScript(script, args, { ...options, cwd: dir });
}

export async function spawnScript(
  script: string,
  args: string[] = [],
  options: SpawnOptions & { cwd?: string } = {}
): Promise<RunResult> {
  const started = performance.now();

  const proc = Bun.spawn([options.runtime ?? 'node', ...(options.denoArgs ?? []), script, ...args], {
    cwd: options.cwd,
    stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1', CI: '', ...options.env }
  });

  if (options.signal) {
    setTimeout(() => {
      try {
        proc.kill(options.signal === 'SIGTERM' ? 15 : 2);
      } catch {
        /* already gone */
      }
    }, options.signalAfterMs ?? 300);
  }

  const timer = options.timeoutMs
    ? setTimeout(() => proc.kill(9), options.timeoutMs)
    : null;

  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ]);
  if (timer) clearTimeout(timer);

  const signalled = proc.signalCode;
  const observed =
    code !== 0 ? code : signalled === 'SIGINT' ? 130 : signalled === 'SIGTERM' ? 143 : code;

  return decorate(observed, stdout, stderr, performance.now() - started);
}

/**
 * Register a conformance test against a clause of `CONTRACT.md`.
 *
 * The clause id is part of the test name, and `coverage.conformance.test.ts`
 * scans this directory for these calls to prove every MUST clause is covered.
 */
export function T(clause: string, description: string, fn: () => unknown, timeoutMs?: number): void {
  test(`T/${clause} — ${description}`, fn as never, timeoutMs);
}
