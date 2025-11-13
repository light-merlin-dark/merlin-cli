import type { BootstrapConfig } from '../types/index.ts';

export { type BootstrapConfig };

let bootstrapped = false;

export async function bootstrap(config: BootstrapConfig): Promise<void> {
  // Prevent double-bootstrapping
  if (bootstrapped) {
    return;
  }
  bootstrapped = true;

  const { registry } = config;

  // Set up global error handlers
  process.on('uncaughtException', (error: Error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
    console.error('Unhandled Rejection:', reason);
    process.exit(1);
  });

  // Set up graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      // Allow pending I/O to complete
      await new Promise(resolve => setImmediate(resolve));
      process.exit(0);
    });
  }

  // Additional bootstrap logic can be added here
  // For example, loading environment variables, checking dependencies, etc.
}