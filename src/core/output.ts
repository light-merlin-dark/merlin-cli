/**
 * The output plane: one result, several renderings.
 *
 * A command computes a result. What an observer sees is a projection of that
 * one result — human text, a JSON envelope, or a stream of NDJSON lines — and
 * the exit code is a fourth projection of the same fact. Because there is one
 * source, the channels cannot disagree.
 *
 * The other half of its job is stream discipline. stdout carries payload only;
 * every log line, warning, prompt and progress tick is commentary and belongs
 * on stderr. `mycli export | jq .` should never receive `[INFO] connecting…`
 * as input.
 */

const CONTRACT_VERSION = '2.0';

export type OutputFormat = 'text' | 'json' | 'ndjson';

export type EventLevel = 'info' | 'error' | 'warn' | 'debug' | 'success';

export interface EnvelopeError {
  message: string;
  stack?: string;
}

export interface Envelope<T = unknown> {
  ok: boolean;
  code: number;
  command: string;
  data: T | null;
  error: EnvelopeError | null;
  cli: { name: string; version: string; contract: string };
}

export interface OutputOptions {
  name: string;
  version: string;
  /** Tokens the CLI was invoked with, used to detect the reserved flags. */
  argv: string[];
  verbose?: boolean;
  quiet?: boolean;
  /** Streams to write to. Overridable so tests can capture without spawning. */
  stdout?: { write(chunk: string): unknown };
  stderr?: { write(chunk: string): unknown };
}

/** Keys a command may use to signal outcome; they are not part of its payload. */
const OUTCOME_KEYS = ['success', 'exitCode', 'error'] as const;

/**
 * The payload inside a return value.
 *
 * A command that returns `{ success: false, error: 'no such zone' }` has
 * returned no data — those keys are outcome signalling. A command that returns
 * `{ record: 'A', ttl: 300 }` has returned exactly that.
 */
export function extractData(result: unknown): unknown {
  if (result === undefined || result === null) return null;
  if (typeof result !== 'object' || Array.isArray(result)) return result;

  const source = result as Record<string, unknown>;

  // `{ data: ... }` is the shape 1.x documented for a payload alongside a
  // status, so it unwraps rather than nesting.
  if ('data' in source) {
    const keys = Object.keys(source).filter(key => !(OUTCOME_KEYS as readonly string[]).includes(key));
    if (keys.length === 1 && keys[0] === 'data') return source.data;
  }

  const rest: Record<string, unknown> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(source)) {
    if ((OUTCOME_KEYS as readonly string[]).includes(key)) continue;
    rest[key] = value;
    kept++;
  }

  return kept === 0 ? null : rest;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => {
    if (entry instanceof Error) return { message: entry.message, name: entry.name };
    if (entry instanceof Map) return Object.fromEntries(entry);
    if (entry instanceof Set) return [...entry];
    if (typeof entry === 'bigint') return entry.toString();
    return entry;
  });
}

export class Output {
  readonly requested: { json: boolean; ndjson: boolean };
  format: OutputFormat;

  private readonly out: { write(chunk: string): unknown };
  private readonly err: { write(chunk: string): unknown };
  private readonly name: string;
  private readonly version: string;
  private readonly verbose: boolean;
  private readonly quiet: boolean;

  /** Events seen before the format was settled, replayed once it is. */
  private pending: Array<{ level: EventLevel; message: string }> = [];
  private settled = false;

  /** Items given to `ctx.emit`, kept only in `--json` mode (see `emit`). */
  private collected: unknown[] = [];
  private emitted = false;

  private restoreStreams: (() => void) | null = null;
  /** stdout's real `write`, kept while the capture is installed. */
  private rawWrite: ((chunk: string) => unknown) | null = null;
  private lineBuffer = '';
  private finished = false;
  /** Last error the plane saw, used as the envelope's message. */
  private lastError: string | null = null;

  constructor(options: OutputOptions) {
    this.name = options.name;
    this.version = options.version;
    this.out = options.stdout ?? process.stdout;
    this.err = options.stderr ?? process.stderr;
    this.verbose = options.verbose ?? options.argv.includes('--verbose');
    this.quiet = options.quiet ?? options.argv.includes('--quiet');

    // Only tokens before `--` select a mode; after it, `--json` is data.
    const separator = options.argv.indexOf('--');
    const flags = separator === -1 ? options.argv : options.argv.slice(0, separator);

    this.requested = {
      json: flags.includes('--json'),
      ndjson: flags.includes('--ndjson')
    };

    // Provisional: a command that declares its own `--json` can still take it
    // back in `settle`, before anything has been written.
    this.format = this.requested.ndjson ? 'ndjson' : this.requested.json ? 'json' : 'text';
  }

  get isMachine(): boolean {
    return this.format !== 'text';
  }

  get isVerbose(): boolean {
    return this.verbose;
  }

  /**
   * Fix the output format, once the command is known.
   *
   * A command that declares an option called `json` or `ndjson` means its own
   * thing by it; the framework defers and stays in text mode (MODE-5). Several
   * CLIs owned `--json` years before this contract existed, and none of them
   * should change behaviour on upgrade.
   */
  settle(shadowed: { json?: boolean; ndjson?: boolean } = {}): void {
    if (this.settled) return;
    this.settled = true;

    const json = this.requested.json && !shadowed.json;
    const ndjson = this.requested.ndjson && !shadowed.ndjson;
    this.format = ndjson ? 'ndjson' : json ? 'json' : 'text';

    if (this.isMachine) this.captureStdout();

    const queued = this.pending;
    this.pending = [];
    for (const entry of queued) this.writeEvent(entry.level, entry.message);
  }

  /**
   * Offer a log event to the plane.
   *
   * Returns `true` when the plane has taken responsibility for it and the
   * logger must not also print it — which is every event in machine mode, where
   * commentary is re-rendered as NDJSON on stderr.
   */
  event(level: EventLevel, message: string): boolean {
    if (this.quiet && (level === 'info' || level === 'success')) return true;

    if (!this.settled) {
      // The format is not known yet — usually a bootstrap log. Hold it rather
      // than write it into a document that may turn out to be JSON.
      this.pending.push({ level, message });
      return true;
    }

    if (level === 'error') this.lastError = message;

    if (!this.isMachine) return false;
    if (level === 'debug' && !this.verbose) return true;

    this.writeEvent(level, message);
    return true;
  }

  private writeEvent(level: EventLevel, message: string): void {
    if (level === 'error') this.lastError = message;

    if (!this.isMachine) {
      // Replay of a pre-settle event in text mode: the logger has already
      // returned, so the plane prints it, on stderr where commentary belongs.
      if (level === 'debug' && !this.verbose) return;
      this.err.write(`[${level.toUpperCase()}] ${message}\n`);
      return;
    }
    if (level === 'debug' && !this.verbose) return;
    this.err.write(stableStringify({ ev: 'log', level, msg: message }) + '\n');
  }

  /**
   * Stream one payload item.
   *
   * In `--ndjson` this writes a line immediately and keeps nothing, which is
   * what makes it constant-memory over a million items. In `--json` the caller
   * asked for a single document, so items are collected into it; that is a
   * deliberate memory trade the caller chose by picking the mode.
   */
  emit(item: unknown, render?: (item: unknown) => string): void {
    this.emitted = true;

    if (this.format === 'ndjson') {
      this.writeRaw(stableStringify(item) + '\n');
      return;
    }

    if (this.format === 'json') {
      this.collected.push(item);
      return;
    }

    if (render) this.writeRaw(render(item) + '\n');
  }

  /** Write payload bytes to stdout. Used by help, version and manifest. */
  writePayload(text: string): void {
    if (text === '') return;
    this.writeRaw(text.endsWith('\n') ? text : text + '\n');
  }

  /**
   * Write payload bytes to the real stdout.
   *
   * In machine mode the plane has replaced `process.stdout.write` so that a
   * command's stray `console.log` cannot corrupt the document. Its own payload
   * must go around that replacement, or the envelope would be relayed to stderr
   * as commentary.
   */
  private writeRaw(text: string): void {
    if (this.rawWrite) this.rawWrite(text);
    else this.out.write(text);
  }

  /**
   * Render the final result and release the streams.
   *
   * In machine mode this is the envelope: `ok`, `code` and the process's actual
   * exit status are three renderings of one fact, so they cannot disagree.
   */
  finish(final: { code: number; command: string; result: unknown; error?: unknown; render?: (data: unknown) => string }): void {
    // A signal can race a normal completion. Whichever gets here first is the
    // rendering; a second envelope would be a second, contradictory answer.
    if (this.finished) return;
    this.finished = true;

    const data = this.resolveData(final.result);

    if (!this.isMachine) {
      this.releaseStdout();
      if (final.render && data !== null && data !== undefined) {
        const text = final.render(data);
        if (typeof text === 'string' && text !== '') this.writePayload(text);
      }
      return;
    }

    if (this.format === 'ndjson') {
      const line = stableStringify(this.envelope(final, this.emitted ? null : data)) + '\n';
      this.releaseStdout();
      this.out.write(line);
      return;
    }

    const document = JSON.stringify(this.envelope(final, data), null, 2) + '\n';
    this.releaseStdout();
    this.out.write(document);
  }

  private resolveData(result: unknown): unknown {
    const data = extractData(result);
    if (this.format === 'json' && this.emitted && data === null) return this.collected;
    return data;
  }

  private envelope(
    final: { code: number; command: string; result: unknown; error?: unknown },
    data: unknown
  ): Envelope {
    return {
      ok: final.code === 0,
      code: final.code,
      command: final.command,
      data: data ?? null,
      error: this.envelopeError(final),
      cli: { name: this.name, version: this.version, contract: CONTRACT_VERSION }
    };
  }

  private envelopeError(final: { code: number; result: unknown; error?: unknown }): EnvelopeError | null {
    if (final.code === 0) return null;

    const source =
      final.error ??
      (final.result && typeof final.result === 'object'
        ? (final.result as { error?: unknown }).error
        : undefined);

    const message =
      source instanceof Error
        ? source.message
        : typeof source === 'string'
          ? source
          : source !== undefined && source !== null
            ? String(source)
            : (this.lastError ?? `Command failed with exit code ${final.code}`);

    const error: EnvelopeError = { message };
    if (this.verbose && source instanceof Error && source.stack) error.stack = source.stack;
    return error;
  }

  /**
   * Redirect everything a command writes to stdout onto stderr as events.
   *
   * Without this, one `console.log` in a command body corrupts the JSON
   * document the caller is parsing. Consumers print with `console.log`
   * everywhere and cannot all be rewritten; making the framework responsible
   * for the channel is what lets `--json` work on day one for CLIs that were
   * written years before this contract.
   */
  private captureStdout(): void {
    if (this.restoreStreams) return;

    const stdout = process.stdout as unknown as { write: (...args: unknown[]) => boolean };
    const originalWrite = stdout.write.bind(process.stdout);
    this.rawWrite = originalWrite as unknown as (chunk: string) => unknown;
    const console_ = globalThis.console as unknown as Record<string, unknown>;
    const originals: Record<string, unknown> = {};

    const relay = (chunk: unknown): boolean => {
      const text = typeof chunk === 'string' ? chunk : String(chunk);
      this.lineBuffer += text;
      let index = this.lineBuffer.indexOf('\n');
      while (index !== -1) {
        const line = this.lineBuffer.slice(0, index);
        this.lineBuffer = this.lineBuffer.slice(index + 1);
        this.err.write(stableStringify({ ev: 'out', text: line }) + '\n');
        index = this.lineBuffer.indexOf('\n');
      }
      return true;
    };

    stdout.write = (chunk: unknown, ...rest: unknown[]) => {
      const callback = rest.find(argument => typeof argument === 'function') as
        | (() => void)
        | undefined;
      const written = relay(chunk);
      callback?.();
      return written;
    };

    const asLine = (args: unknown[]): string =>
      args.map(argument => (typeof argument === 'string' ? argument : inspectish(argument))).join(' ');

    for (const method of ['log', 'info', 'debug', 'dir'] as const) {
      originals[method] = console_[method];
      console_[method] = (...args: unknown[]) => relay(asLine(args) + '\n');
    }

    for (const [method, level] of [['warn', 'warn'], ['error', 'error']] as const) {
      originals[method] = console_[method];
      console_[method] = (...args: unknown[]) => this.writeEvent(level, asLine(args));
    }

    this.restoreStreams = () => {
      stdout.write = originalWrite as unknown as typeof stdout.write;
      for (const [method, fn] of Object.entries(originals)) console_[method] = fn;
    };
  }

  /** Flush any partial line and put the real stdout back. */
  private releaseStdout(): void {
    if (!this.restoreStreams) return;

    if (this.lineBuffer !== '') {
      this.err.write(stableStringify({ ev: 'out', text: this.lineBuffer }) + '\n');
      this.lineBuffer = '';
    }

    this.restoreStreams();
    this.restoreStreams = null;
    this.rawWrite = null;
  }

  /** Restore streams without writing anything. For abnormal termination. */
  abandon(): void {
    this.releaseStdout();
  }
}

function inspectish(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

let active: Output | null = null;

/** The plane the current `run()` is writing through, if any. */
export function currentOutput(): Output | null {
  return active;
}

export function setOutput(output: Output | null): void {
  active = output;
}

export { CONTRACT_VERSION };
