/**
 * The manifest: a CLI describing its entire surface in one deterministic call.
 *
 * A caller that can read this needs no skill file, no scraped `--help`, and no
 * wiki that went stale in March. It is built purely from declarations, so it
 * loads no command implementation and produces the same bytes on every run —
 * which also makes `diff` of two manifests a usable API-change review.
 */

import { describe, isThunk } from '../commands/lazy.ts';
import { RESERVED_OPTIONS } from './grammar.ts';
import { CONTRACT_VERSION } from './output.ts';
import type { ArgSpec, Command, CommandDefinition, OptionSpec } from '../types/index.ts';

export const MANIFEST_SCHEMA = 'merlin-cli/manifest/v2';

/** Command names the framework provides unless the CLI defines its own. */
export const RESERVED_COMMANDS = ['help', 'version', 'manifest'] as const;

export interface ManifestArg {
  name: string;
  type: string;
  description: string;
  required: boolean;
  choices?: readonly unknown[];
  default?: unknown;
}

export interface ManifestOption {
  name: string;
  type: string;
  description: string;
  required: boolean;
  alias?: string;
  choices?: readonly unknown[];
  default?: unknown;
  env?: string;
}

export interface ManifestCommand {
  name: string;
  path: string[];
  description: string;
  usage: string;
  aliases: string[];
  /** False for a 1.x thunk, which cannot be described without loading it. */
  described: boolean;
  lazy: boolean;
  args: ManifestArg[];
  options: ManifestOption[];
  examples: string[];
  exitCodes: Array<{ code: number; meaning: string }>;
  /** Reserved option names this command redefines, and so takes back. */
  shadows: string[];
  subcommands: ManifestCommand[];
}

export interface Manifest {
  $schema: string;
  contract: string;
  name: string;
  version: string;
  description: string;
  reserved: { commands: string[]; options: string[] };
  commands: ManifestCommand[];
}

function manifestArg(name: string, spec: ArgSpec): ManifestArg {
  const entry: ManifestArg = {
    name,
    type: spec.type,
    description: spec.description ?? '',
    required: Boolean(spec.required)
  };
  if (spec.choices) entry.choices = spec.choices;
  if (spec.default !== undefined) entry.default = spec.default;
  return entry;
}

function manifestOption(name: string, spec: OptionSpec): ManifestOption {
  const entry: ManifestOption = {
    name,
    type: spec.type,
    description: spec.description ?? '',
    required: Boolean(spec.required)
  };
  if (spec.alias) entry.alias = spec.alias;
  if (spec.choices) entry.choices = spec.choices;
  if (spec.default !== undefined) entry.default = spec.default;
  if (spec.env) entry.env = spec.env;
  return entry;
}

function describeCommand(name: string, definition: CommandDefinition, path: string[]): ManifestCommand {
  const metadata = describe(definition);
  const lazy = isThunk(definition) || (typeof definition === 'object' && 'load' in definition);

  if (!metadata) {
    return {
      name,
      path,
      description: '(loads on first use)',
      usage: path.join(' '),
      aliases: [],
      described: false,
      lazy: true,
      args: [],
      options: [],
      examples: [],
      exitCodes: [],
      shadows: [],
      subcommands: []
    };
  }

  const options = metadata.options ?? {};
  const args = metadata.args ?? {};

  return {
    name,
    path,
    description: metadata.description ?? '',
    usage: metadata.usage ?? path.join(' '),
    aliases: metadata.aliases ?? [],
    described: true,
    lazy,
    args: Object.entries(args).map(([argName, spec]) => manifestArg(argName, spec)),
    options: Object.entries(options).map(([optionName, spec]) => manifestOption(optionName, spec)),
    examples: metadata.examples ?? [],
    exitCodes: Object.entries(metadata.exitCodes ?? {}).map(([code, meaning]) => ({
      code: Number(code),
      meaning: String(meaning)
    })),
    shadows: (RESERVED_OPTIONS as readonly string[]).filter(reserved => reserved in options),
    subcommands: Object.entries(metadata.subcommands ?? {}).map(([subName, sub]) =>
      describeCommand(subName, sub as Command, [...path, subName])
    )
  };
}

export function buildManifest(config: {
  name: string;
  version: string;
  description?: string;
  commands: Record<string, CommandDefinition>;
}): Manifest {
  return {
    $schema: MANIFEST_SCHEMA,
    contract: CONTRACT_VERSION,
    name: config.name,
    version: config.version,
    description: config.description ?? '',
    reserved: {
      commands: [...RESERVED_COMMANDS],
      options: [...RESERVED_OPTIONS]
    },
    // Declaration order, everywhere. The author's file is the source of truth
    // for sequence; nothing is sorted "helpfully".
    commands: Object.entries(config.commands).map(([name, definition]) =>
      describeCommand(name, definition, [name])
    )
  };
}

/** Find one command's manifest entry by its path, without loading anything. */
export function manifestSubtree(manifest: Manifest, path: string[]): ManifestCommand | null {
  let commands = manifest.commands;
  let found: ManifestCommand | null = null;

  for (const segment of path) {
    found =
      commands.find(command => command.name === segment || command.aliases.includes(segment)) ?? null;
    if (!found) return null;
    commands = found.subcommands;
  }

  return found;
}
