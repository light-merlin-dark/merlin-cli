import { createCommand } from '../create-command.ts';
import type { Command } from '../../types/index.ts';

export interface VersionCommandOptions {
  version: string;
  name: string;
}

export function createVersionCommand(config: VersionCommandOptions): Command<void> {
  return createCommand({
    name: 'version',
    description: 'Show version information',
    usage: 'version',
    examples: [
      'version            # Show version',
      'version --verbose  # Show detailed version info'
    ],
    options: {
      verbose: {
        type: 'boolean',
        description: 'Show detailed version information'
      }
    },

    execute: async ({ options }) => {
      if (options.verbose) {
        console.log(`${config.name} v${config.version}`);
        console.log(`Node.js: ${process.version}`);
        console.log(`Platform: ${process.platform} ${process.arch}`);
        console.log(`PID: ${process.pid}`);
      } else {
        console.log(`v${config.version}`);
      }
    }
  });
}