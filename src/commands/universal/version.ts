import { createCommand } from '../create-command.ts';
import type { Command } from '../../types/index.ts';

export interface VersionCommandOptions {
  version: string;
  name: string;
}

interface VersionData {
  name: string;
  version: string;
  runtime?: string;
  platform?: string;
  arch?: string;
}

/**
 * `version` prints exactly `<name> <version>` and nothing else.
 *
 * It is parsed by more scripts than any other output a CLI produces, so it is
 * the one line that must never acquire a decoration.
 */
export function createVersionCommand(config: VersionCommandOptions): Command<VersionData> {
  return createCommand({
    name: 'version',
    description: 'Show version information',
    usage: 'version',
    examples: ['version', 'version --json'],
    options: {},

    render: (data: VersionData) => {
      const lines = [`${data.name} ${data.version}`];
      if (data.runtime) lines.push(`runtime: ${data.runtime}`);
      if (data.platform) lines.push(`platform: ${data.platform} ${data.arch}`);
      return lines.join('\n');
    },

    execute: ({ options }) => {
      const data: VersionData = { name: config.name, version: config.version };

      if (options.verbose) {
        data.runtime = `${typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ? 'bun' : 'node'} ${process.version}`;
        data.platform = process.platform;
        data.arch = process.arch;
      }

      return data;
    }
  });
}
