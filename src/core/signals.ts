/**
 * Ctrl-C is an API.
 *
 * A command gets an `AbortSignal` and a bounded window to clean up. After the
 * window closes — or on a second signal — the process leaves with the code the
 * shell expects for that signal. A cleanup handler does not get to convert an
 * interrupt into a success: an interrupted command did not succeed.
 */

export const SIGINT_EXIT_CODE = 130;
export const SIGTERM_EXIT_CODE = 143;

export interface SignalHandling {
  signal: AbortSignal;
  /**
   * The exit code the received signal demands, or `null` if none arrived.
   *
   * Read after the command returns: a cleanup handler that swallows the abort
   * and returns normally must still not be able to report success.
   */
  readonly interruptedWith: number | null;
  /** Remove the handlers and cancel any pending grace timer. */
  dispose(): void;
}

export function installSignalHandling(options: {
  gracePeriodMs?: number;
  /** Called once, before the process leaves, with the code it will leave with. */
  onTerminate?: (code: number) => void;
  exit?: (code: number) => void;
}): SignalHandling {
  const controller = new AbortController();
  const grace = options.gracePeriodMs ?? 3000;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  let timer: ReturnType<typeof setTimeout> | null = null;
  let signalled = false;
  let interruptedWith: number | null = null;

  const leave = (code: number): void => {
    if (timer) clearTimeout(timer);
    try {
      options.onTerminate?.(code);
    } finally {
      exit(code);
    }
  };

  const handler = (code: number) => () => {
    if (signalled) {
      // Second signal: the caller has asked twice. Go now.
      leave(code);
      return;
    }
    signalled = true;
    interruptedWith = code;
    controller.abort();
    timer = setTimeout(() => leave(code), grace);
  };

  const onInt = handler(SIGINT_EXIT_CODE);
  const onTerm = handler(SIGTERM_EXIT_CODE);

  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);

  return {
    signal: controller.signal,
    get interruptedWith(): number | null {
      return interruptedWith;
    },
    dispose(): void {
      if (timer) clearTimeout(timer);
      process.removeListener('SIGINT', onInt);
      process.removeListener('SIGTERM', onTerm);
    }
  };
}
