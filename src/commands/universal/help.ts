import { createCommand } from '../create-command.ts';
import type { Command, CommandDefinition, HelpOptions } from '../../types/index.ts';
import { buildManifest, manifestSubtree, type Manifest } from '../../core/manifest.ts';
import { formatManifest, formatManifestCommand, formatAllExamples } from '../../utils/help-formatter.ts';
import { UsageError } from '../../core/errors.ts';

export interface HelpCommandOptions {
  name: string;
  version?: string;
  description?: string;
  commands: Record<string, CommandDefinition>;
  options?: HelpOptions;
}

/**
 * Help, as a projection of the manifest.
 *
 * It returns data and declares how to render it, like any other command, which
 * is what makes `help --json` fall out for free: the same subtree an agent
 * reads is the one a human sees formatted.
 */
export function createHelpCommand(config: HelpCommandOptions): Command<unknown> {
  const manifest = (): Manifest =>
    buildManifest({
      name: config.name,
      version: config.version ?? '',
      description: config.description,
      commands: config.commands
    });

  return createCommand({
    name: 'help',
    description: 'Show help information',
    usage: 'help [command] [subcommand...]',
    examples: [
      'help',
      'help deploy',
      'help --examples',
      'help --json'
    ],
    options: {
      examples: {
        type: 'boolean',
        description: 'Show practical examples for all commands'
      }
    },

    render: (data: unknown) => {
      if (typeof data === 'string') return data;
      const entry = data as Manifest | { path?: string[] };
      return 'path' in entry && entry.path
        ? formatManifestCommand(entry as never)
        : formatManifest(entry as Manifest);
    },

    execute: async ({ args, options }) => {
      if (options.examples) {
        return formatAllExamples(config.commands);
      }

      if (args.length === 0) {
        return manifest();
      }

      const subtree = manifestSubtree(manifest(), args);
      if (!subtree) {
        throw new UsageError(`Unknown command: ${args.join(' ')}`);
      }

      return subtree;
    }
  });
}
