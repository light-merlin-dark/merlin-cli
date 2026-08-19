import { spawn } from 'node:child_process';
import { createCLI } from '../core/cli.ts';
import type { CLIConfig, CommandDefinition } from '../types/index.ts';

/**
 * Two ways to exercise a CLI, because they answer different questions.
 *
 * `runCLI` runs the whole pipeline in process — grammar, validation,
 * middleware, rendering, exit resolution — and is fast enough to use per test.
 *
 * `spawnCLI` runs the built artifact in a real subprocess and reads the real
 * exit status. It is slower and it is the only thing that can catch the class
 * of defect that made this package ship a tree-shaken stub, or a consumer's
 * wrapper read `result.status` where Bun sets `exitCode` and turn every failure
 * into a success one line before the shell.
 */

export interface RunResult {
  /** The exit code the framework derived. */
  code: number;
  /** Payload bytes. */
  stdout: string;
  /** Commentary bytes. */
  stderr: string;
  /** `stdout` parsed as the JSON envelope. Throws if it is not one. */
  json(): {
    ok: boolean;
    code: number;
    command: string;
    data: unknown;
    error: { message: string; stack?: string } | null;
    cli: { name: string; version: string; contract: string };
  };
  /** Convenience for `json().data`. */
  data(): unknown;
  /** NDJSON lines parsed from stdout, envelope excluded. */
  items(): unknown[];
  /** NDJSON events parsed from stderr. */
  events(): Array<Record<string, unknown>>;
}

function collector(): { text: () => string; sink: { write(chunk: string): boolean } } {
  let buffer = '';
  return {
    text: () => buffer,
    sink: {
      write(chunk: string): boolean {
        buffer += chunk;
        return true;
      }
    }
  };
}

function decorate(code: number, stdout: string, stderr: string): RunResult {
  return {
    code,
    stdout,
    stderr,
    json() {
      const trimmed = stdout.trim();
      if (trimmed === '') throw new Error('No JSON envelope on stdout (stdout was empty)');
      const lines = trimmed.split('\n');
      return JSON.parse(lines.length === 1 ? trimmed : lines[lines.length - 1]);
    },
    data() {
      return this.json().data;
    },
    items() {
      return stdout
        .trim()
        .split('\n')
        .filter(line => line !== '')
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

/**
 * Run a CLI definition end to end, in process, capturing both streams.
 *
 * The process is never exited and never killed: `exitProcess` is forced off so
 * the derived code is returned instead.
 */
export async function runCLI(
  config: Omit<CLIConfig, 'exitProcess' | 'streams'> & { commands?: Record<string, CommandDefinition> },
  args: string[] = []
): Promise<RunResult> {
  const out = collector();
  const err = collector();

  const cli = createCLI({
    ...config,
    exitProcess: false,
    streams: { stdout: out.sink, stderr: err.sink }
  });

  const code = await cli.run(args);
  return decorate(code, out.text(), err.text());
}

export interface SpawnOptions {
  /** Working directory for the child. */
  cwd?: string;
  /** Extra environment. `NO_COLOR` is set unless you override it. */
  env?: Record<string, string | undefined>;
  /** Bytes to write to the child's stdin. Defaults to closing it immediately. */
  stdin?: string;
  /** Executable to run the script with. Defaults to the current runtime. */
  runtime?: string;
  timeoutMs?: number;
  /** Signal to send after `signalAfterMs`, to exercise cancellation. */
  signal?: NodeJS.Signals;
  signalAfterMs?: number;
}

/**
 * Run a CLI script in a real subprocess and read the real exit status.
 *
 * This is what the conformance suite asserts against, and it is exported
 * because consumers proved they need it: an in-process test cannot see a
 * wrapper that discards the exit code.
 */
export async function spawnCLI(
  script: string,
  args: string[] = [],
  options: SpawnOptions = {}
): Promise<RunResult> {
  const runtime = options.runtime ?? process.execPath;

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(runtime, [script, ...args], {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: '1', ...options.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });

    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    child.stdin.end();

    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
          if (!settled) {
            settled = true;
            reject(new Error(`spawnCLI timed out after ${options.timeoutMs}ms: ${script} ${args.join(' ')}`));
          }
        }, options.timeoutMs)
      : null;

    if (options.signal) {
      setTimeout(() => child.kill(options.signal), options.signalAfterMs ?? 200);
    }

    child.on('error', error => {
      if (timer) clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (settled) return;
      settled = true;
      // A process killed by a signal reports no code; the shell would report
      // 128 + signal number, which is what a caller actually observes.
      const resolved = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
      resolve(decorate(resolved, stdout, stderr));
    });
  });
}
