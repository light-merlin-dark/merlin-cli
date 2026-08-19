import { colors } from './colors.ts';
import type { Command, CommandDefinition, HelpOptions } from '../types/index.ts';
import type { Manifest, ManifestCommand } from '../core/manifest.ts';

export interface HelpCommandOptions {
  name: string;
  description?: string;
  commands: Record<string, CommandDefinition>;
  options?: HelpOptions;
}

/**
 * Help is a rendering of the manifest, not a second hand-written description of
 * the same commands. That is the only way the two cannot drift.
 */

function usageLine(command: ManifestCommand): string {
  const positional = command.args
    .map(arg => (arg.required ? `<${arg.name}>` : `[${arg.name}]`))
    .join(' ');

  const base = command.usage && command.usage !== command.path.join(' ') ? command.usage : command.path.join(' ');
  return positional && !base.includes('<') && !base.includes('[') ? `${base} ${positional}` : base;
}

/** Full detail for one command: usage, arguments, options, examples. */
export function formatManifestCommand(command: ManifestCommand): string {
  const lines: string[] = [];

  lines.push(colors.bold(command.path.join(' ')));
  if (command.description) lines.push(command.description);
  lines.push('');

  lines.push(colors.bold('Usage:'));
  lines.push(`  ${usageLine(command)}`);
  lines.push('');

  if (command.args.length > 0) {
    lines.push(colors.bold('Arguments:'));
    const width = Math.max(...command.args.map(arg => arg.name.length));
    for (const arg of command.args) {
      const required = arg.required ? ' (required)' : '';
      const choices = arg.choices ? ` {${arg.choices.join('|')}}` : '';
      lines.push(`  ${arg.name.padEnd(width + 2)}${arg.description}${required}${choices} [${arg.type}]`);
    }
    lines.push('');
  }

  const visibleSubcommands = command.subcommands;
  if (visibleSubcommands.length > 0) {
    lines.push(colors.bold('Subcommands:'));
    const width = Math.max(...visibleSubcommands.map(sub => sub.name.length));
    for (const sub of visibleSubcommands) {
      lines.push(`  ${sub.name.padEnd(width + 2)}${sub.description}`);
    }
    lines.push('');
    lines.push(`Run '${command.path.join(' ')} <subcommand> --help' for detail on a subcommand.`);
    lines.push('');
  }

  if (command.options.length > 0) {
    lines.push(colors.bold('Options:'));
    for (const option of command.options) {
      const flags = option.alias ? `  -${option.alias}, --${option.name}` : `  --${option.name}`;
      const required = option.required ? ' (required)' : '';
      const fallback = option.default !== undefined ? ` [default: ${String(option.default)}]` : '';
      const fromEnv = option.env ? ` [env: ${option.env}]` : '';
      const choices = option.choices ? ` {${option.choices.join('|')}}` : '';
      lines.push(`${flags}  ${option.description}${required}${choices}${fallback}${fromEnv}`);
    }
    lines.push('');
  }

  if (command.exitCodes.length > 0) {
    lines.push(colors.bold('Exit codes:'));
    for (const entry of command.exitCodes) lines.push(`  ${entry.code}  ${entry.meaning}`);
    lines.push('');
  }

  if (command.examples.length > 0) {
    lines.push(colors.bold('Examples:'));
    for (const example of command.examples) lines.push(`  ${example}`);
    lines.push('');
  }

  if (command.aliases.length > 0) {
    lines.push(colors.bold('Aliases:'));
    lines.push(`  ${command.aliases.join(', ')}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/** One line per command — the top-level view. */
export function formatManifest(manifest: Manifest): string {
  const lines: string[] = [];

  lines.push(colors.bold(manifest.name) + (manifest.version ? ` ${manifest.version}` : ''));
  if (manifest.description) lines.push(manifest.description);
  lines.push('');
  lines.push(colors.bold('Commands:'));

  const listed = manifest.commands;
  const width = listed.length > 0 ? Math.max(...listed.map(command => command.name.length)) : 0;

  for (const command of listed) {
    lines.push(`  ${command.name.padEnd(width + 2)}${command.description}`);
  }

  lines.push('');
  lines.push(`Run '${manifest.name} help <command>' for detail, or '${manifest.name} manifest' for the machine-readable surface.`);

  return lines.join('\n');
}

/**
 * 1.x entry points, kept so consumers importing them keep compiling. They now
 * project through the manifest like everything else.
 */
export function formatCommandHelp(command: Command, options?: HelpOptions): string {
  if (options?.format === 'json') {
    // Deliberately the 1.x shape, keyed by name, not the manifest's array of
    // entries. `help --json` returns the manifest; this legacy entry point
    // keeps its own contract with whoever already calls it.
    return JSON.stringify(
      {
        name: command.name,
        description: command.description,
        usage: command.usage,
        examples: command.examples,
        options: command.options,
        args: command.args,
        aliases: command.aliases
      },
      null,
      2
    );
  }

  return formatManifestCommand(toManifestCommand(command));
}

export async function formatGeneralHelp(config: HelpCommandOptions): Promise<string> {
  const { buildManifest } = await import('../core/manifest.ts');
  return formatManifest(
    buildManifest({
      name: config.name,
      version: '',
      description: config.description,
      commands: config.commands
    })
  );
}

export async function formatAllExamples(commands: Record<string, CommandDefinition>): Promise<string> {
  const { describe } = await import('../commands/lazy.ts');
  const lines: string[] = [colors.bold('Command Examples:'), ''];

  for (const [name, definition] of Object.entries(commands)) {
    const metadata = describe(definition) ?? (typeof definition === 'function' ? await definition() : null);
    if (!metadata?.examples?.length) continue;

    lines.push(colors.bold(name));
    for (const example of metadata.examples) lines.push(`  ${example}`);
    lines.push('');
  }

  return lines.join('\n');
}

function toManifestCommand(command: Command, path: string[] = [command.name]): ManifestCommand {
  return {
    name: command.name,
    path,
    description: command.description ?? '',
    usage: command.usage ?? path.join(' '),
    aliases: command.aliases ?? [],
    described: true,
    lazy: false,
    args: Object.entries(command.args ?? {}).map(([name, spec]) => ({
      name,
      type: spec.type,
      description: spec.description ?? '',
      required: Boolean(spec.required),
      ...(spec.choices ? { choices: spec.choices } : {}),
      ...(spec.default !== undefined ? { default: spec.default } : {})
    })),
    options: Object.entries(command.options ?? {}).map(([name, spec]) => ({
      name,
      type: spec.type,
      description: spec.description ?? '',
      required: Boolean(spec.required),
      ...(spec.alias ? { alias: spec.alias } : {}),
      ...(spec.choices ? { choices: spec.choices } : {}),
      ...(spec.default !== undefined ? { default: spec.default } : {}),
      ...(spec.env ? { env: spec.env } : {})
    })),
    examples: command.examples ?? [],
    exitCodes: Object.entries(command.exitCodes ?? {}).map(([code, meaning]) => ({
      code: Number(code),
      meaning: String(meaning)
    })),
    shadows: [],
    subcommands: Object.entries(command.subcommands ?? {}).map(([name, sub]) =>
      toManifestCommand(sub, [...path, name])
    )
  };
}
