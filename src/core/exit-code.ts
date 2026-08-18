/**
 * Exit-code resolution for command results.
 *
 * Commands signal failure in two ways: by throwing, or by returning a result
 * object carrying `success: false` / an explicit `exitCode`. The router used to
 * discard return values entirely, so the second channel exited 0 — a failure
 * that printed an error but told every caller, CI gate and agent it had worked.
 *
 * This maps a command's return value onto a process exit code. Anything that is
 * not an explicit failure signal stays 0, so commands returning plain data
 * (strings, numbers, arrays, records) behave exactly as before.
 */

export interface CommandResult<T = unknown> {
  /** `false` marks the command as failed; the process exits non-zero. */
  success?: boolean;
  /** Explicit process exit code. Wins over `success` when it is a number. */
  exitCode?: number;
  /** Human-readable failure reason. Not used for exit-code resolution. */
  error?: string | Error;
  /** Command payload. Not used for exit-code resolution. */
  data?: T;
  [key: string]: unknown;
}

/** Exit code used when a command reports failure without naming a code. */
export const GENERIC_FAILURE_EXIT_CODE = 1;

/**
 * Clamp an arbitrary number into the range a POSIX process can actually
 * report. `process.exit(256)` silently becomes 0 — that would reintroduce the
 * very fail-open this module exists to close, so out-of-range and non-finite
 * codes collapse to a generic failure instead.
 */
function normalizeExitCode(code: number): number {
  if (!Number.isFinite(code)) {
    return GENERIC_FAILURE_EXIT_CODE;
  }

  const truncated = Math.trunc(code);

  if (truncated === 0) {
    return 0;
  }

  if (truncated < 0 || truncated > 255) {
    return GENERIC_FAILURE_EXIT_CODE;
  }

  return truncated;
}

/**
 * Resolve the exit code implied by a command's return value.
 *
 * - `undefined` / `null` -> 0 (the overwhelmingly common void command)
 * - `{ exitCode: n }` -> n (clamped to 0-255)
 * - `{ success: false }` -> 1
 * - `{ success: true }` -> 0
 * - anything else (data payloads, primitives, arrays) -> 0
 */
export function resolveExitCode(result: unknown): number {
  if (result === undefined || result === null) {
    return 0;
  }

  if (typeof result !== 'object' || Array.isArray(result)) {
    return 0;
  }

  const candidate = result as CommandResult;

  if (typeof candidate.exitCode === 'number') {
    return normalizeExitCode(candidate.exitCode);
  }

  if (candidate.success === false) {
    return GENERIC_FAILURE_EXIT_CODE;
  }

  return 0;
}

/** True when a command's return value signals failure. */
export function isFailureResult(result: unknown): boolean {
  return resolveExitCode(result) !== 0;
}
