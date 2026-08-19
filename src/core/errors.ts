/**
 * Error kinds the framework distinguishes, and how they become exit codes.
 *
 * The distinction that matters is between "you called me wrong" and "I tried
 * and failed". They need different remediation, and a caller that can only see
 * exit code 1 for both has to parse prose to tell them apart.
 */

/** Exit code for a usage error: bad invocation, not a failed operation. */
export const USAGE_EXIT_CODE = 2;

/** Exit code for a runtime failure with no more specific code. */
export const GENERIC_FAILURE_EXIT_CODE = 1;

/**
 * Marks an error as a usage error across realm boundaries.
 *
 * `instanceof` is unreliable here: a consumer may have its own copy of this
 * package in its dependency tree, and two copies of the same class are not the
 * same class. A registered symbol survives that.
 */
export const USAGE_ERROR = Symbol.for('@light-merlin-dark/merlin-cli.usageError');

/** Where an error carries an explicit exit code. Honoured on anything thrown. */
export const EXIT_CODE = Symbol.for('@light-merlin-dark/merlin-cli.exitCode');

/**
 * The caller invoked the CLI incorrectly: unknown command, unknown option,
 * missing required argument, a value of the wrong type, or a prompt with
 * nothing to read from.
 */
export class UsageError extends Error {
  readonly exitCode = USAGE_EXIT_CODE;
  readonly [USAGE_ERROR] = true;
  readonly [EXIT_CODE] = USAGE_EXIT_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export function isUsageError(error: unknown): boolean {
  return Boolean((error as Record<symbol, unknown> | null)?.[USAGE_ERROR]);
}

/**
 * Clamp a number into the range a POSIX process can actually report.
 *
 * `process.exit(256)` reports 0 to the shell. Letting an out-of-range code
 * through would turn a failure into a success at the last possible moment, so
 * anything unrepresentable collapses to a generic failure instead of wrapping.
 */
export function normalizeExitCode(code: number): number {
  if (!Number.isFinite(code)) return GENERIC_FAILURE_EXIT_CODE;

  const truncated = Math.trunc(code);
  if (truncated === 0) return 0;
  if (truncated < 0 || truncated > 255) return GENERIC_FAILURE_EXIT_CODE;

  return truncated;
}

/**
 * The exit code implied by a thrown value.
 *
 * Usage errors are 2. An error carrying a numeric `exitCode` (own property or
 * symbol) uses it, clamped. Everything else is a generic failure.
 */
export function exitCodeOfError(error: unknown): number {
  if (isUsageError(error)) return USAGE_EXIT_CODE;

  const carrier = error as Record<string | symbol, unknown> | null;
  const declared = carrier?.[EXIT_CODE] ?? carrier?.exitCode;

  if (typeof declared === 'number') {
    const code = normalizeExitCode(declared);
    // A thrown error is a failure by definition; a declared 0 does not get to
    // say otherwise.
    return code === 0 ? GENERIC_FAILURE_EXIT_CODE : code;
  }

  return GENERIC_FAILURE_EXIT_CODE;
}

/** The message an observer should see for a thrown value of any shape. */
export function messageOfError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}
