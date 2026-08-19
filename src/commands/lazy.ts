import type { Command, CommandDefinition, LazyCommand } from '../types/index.ts';

/**
 * Declare a command whose implementation loads on first use, but whose
 * description, aliases, args and options are known immediately.
 *
 * ```ts
 * commands: {
 *   migrate: lazy({
 *     name: 'migrate',
 *     description: 'Run pending migrations',
 *     aliases: ['m'],
 *     load: () => import('./commands/migrate.ts').then(m => m.default),
 *   }),
 * }
 * ```
 *
 * The metadata is what `help`, `manifest` and alias resolution read, so none of
 * them has to load a module to answer.
 */
export function lazy(spec: Omit<LazyCommand, 'lazy'>): LazyCommand {
  return { ...spec, lazy: true };
}

export function isLazy(definition: CommandDefinition): definition is LazyCommand {
  return typeof definition === 'object' && definition !== null && (definition as LazyCommand).lazy === true;
}

/** True for 1.x's opaque thunk, which cannot describe itself until loaded. */
export function isThunk(definition: CommandDefinition): definition is () => Promise<Command> {
  return typeof definition === 'function';
}

/**
 * A command's metadata without loading it.
 *
 * Returns `null` only for the opaque 1.x thunk, which has none to give.
 */
export function describe(definition: CommandDefinition): Command | null {
  if (isThunk(definition)) return null;
  if (isLazy(definition)) {
    const { load: _load, lazy: _lazy, ...metadata } = definition;
    return metadata as Command;
  }
  return definition;
}

/** Load a command definition of any form. */
export async function resolveCommand(definition: CommandDefinition): Promise<Command> {
  if (isThunk(definition)) return definition();
  if (isLazy(definition)) {
    const loaded = await definition.load();
    // The declaration is authoritative for metadata the caller has already
    // seen in `help` or the manifest; the module supplies the implementation.
    return {
      ...loaded,
      name: definition.name,
      description: definition.description,
      aliases: definition.aliases ?? loaded.aliases,
      options: definition.options ?? loaded.options,
      args: definition.args ?? loaded.args,
      examples: definition.examples ?? loaded.examples,
      exitCodes: definition.exitCodes ?? loaded.exitCodes
    };
  }
  return definition;
}
