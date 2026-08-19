import type { BootstrapConfig } from '../types/index.ts';

export { type BootstrapConfig };

let bootstrapped = false;

/**
 * Process-level safety net, installed once.
 *
 * Signal handling used to live here and exited `0` on SIGINT, which told every
 * caller that an interrupted command had succeeded. It now belongs to the run
 * itself (`installSignalHandling`), where there is a command to abort and a
 * result to render.
 */
export async function bootstrap(config: BootstrapConfig): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  void config;

  process.on('uncaughtException', (error: Error) => {
    process.stderr.write(`Uncaught exception: ${error?.stack ?? error}\n`);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    process.stderr.write(`Unhandled rejection: ${reason}\n`);
    process.exit(1);
  });
}
