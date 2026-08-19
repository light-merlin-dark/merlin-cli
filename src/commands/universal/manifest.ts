import { createCommand } from '../create-command.ts';
import type { Command, CommandDefinition } from '../../types/index.ts';
import { buildManifest, type Manifest } from '../../core/manifest.ts';

export interface ManifestCommandOptions {
  name: string;
  version: string;
  description?: string;
  commands: Record<string, CommandDefinition>;
}

/**
 * The whole surface of the CLI, in one call, without loading a single command
 * implementation.
 *
 * Deterministic by construction: it is built from declarations in declaration
 * order, so two runs produce identical bytes and a `diff` between versions is a
 * readable API changelog.
 */
export function createManifestCommand(config: ManifestCommandOptions): Command<Manifest> {
  return createCommand({
    name: 'manifest',
    description: 'Print the complete command surface as JSON',
    usage: 'manifest',
    examples: ['manifest', 'manifest | jq .commands[].name'],
    options: {},

    render: (data: Manifest) => JSON.stringify(data, null, 2),

    execute: () =>
      buildManifest({
        name: config.name,
        version: config.version,
        description: config.description,
        commands: config.commands
      })
  });
}
