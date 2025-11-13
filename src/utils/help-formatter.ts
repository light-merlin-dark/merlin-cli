import pc from 'picocolors';
import type { Command, HelpOptions } from '../types/index.ts';

export interface HelpCommandOptions {
  name: string;
  commands: Record<string, Command | (() => Promise<Command>)>;
  options?: HelpOptions;
}

export function formatCommandHelp(command: Command, options?: HelpOptions): string {
  if (options?.format === 'json') {
    return JSON.stringify({
      name: command.name,
      description: command.description,
      usage: command.usage,
      examples: command.examples,
      options: command.options,
      args: command.args,
      aliases: command.aliases
    }, null, 2);
  }

  const lines: string[] = [];
  
  // Header
  lines.push(pc.bold(command.name));
  lines.push(command.description);
  lines.push('');
  
  // Usage
  lines.push(pc.bold('Usage:'));
  let usage = command.usage || command.name;
  if (command.args && Object.keys(command.args).length > 0) {
    const argNames = Object.keys(command.args);
    const argUsage = argNames.map(name => {
      const spec = command.args![name];
      return spec.required ? `<${name}>` : `[${name}]`;
    }).join(' ');
    usage += ` ${argUsage}`;
  }
  lines.push(`  ${usage}`);
  lines.push('');
  
  // Arguments
  if (command.args && Object.keys(command.args).length > 0) {
    lines.push(pc.bold('Arguments:'));
    for (const [name, argSpec] of Object.entries(command.args)) {
      const required = argSpec.required ? ' (required)' : '';
      const type = argSpec.type ? ` [${argSpec.type}]` : '';
      lines.push(`  ${name}  ${argSpec.description}${required}${type}`);
    }
    lines.push('');
  }
  
  // Subcommands
  if (command.subcommands && Object.keys(command.subcommands).length > 0) {
    lines.push(pc.bold('Subcommands:'));
    const subcommandEntries = Object.entries(command.subcommands);
    const maxNameLength = Math.max(...subcommandEntries.map(([name]) => name.length));
    
    for (const [name, subcommand] of subcommandEntries) {
      const paddedName = name.padEnd(maxNameLength + 2);
      lines.push(`  ${paddedName}${subcommand.description}`);
    }
    lines.push('');
    lines.push(`Run '${command.name} <subcommand> --help' for detailed information about a subcommand.`);
    lines.push('');
  }
  
  // Options
  if (command.options && Object.keys(command.options).length > 0) {
    lines.push(pc.bold('Options:'));
    for (const [name, option] of Object.entries(command.options)) {
      const flags = option.alias ? `  -${option.alias}, --${name}` : `  --${name}`;
      const required = option.required ? ' (required)' : '';
      const defaultValue = option.default !== undefined ? ` [default: ${option.default}]` : '';
      lines.push(`${flags}  ${option.description}${required}${defaultValue}`);
    }
    lines.push('');
  }
  
  // Examples
  if (command.examples && command.examples.length > 0) {
    lines.push(pc.bold('Examples:'));
    for (const example of command.examples) {
      lines.push(`  ${example}`);
    }
    lines.push('');
  }
  
  // Aliases
  if (command.aliases && command.aliases.length > 0) {
    lines.push(pc.bold('Aliases:'));
    lines.push(`  ${command.aliases.join(', ')}`);
    lines.push('');
  }
  
  return lines.join('\n');
}

export async function formatGeneralHelp(config: HelpCommandOptions): Promise<string> {
  const lines: string[] = [];
  
  // Header
  lines.push(pc.bold(config.name));
  lines.push('');
  
  // Commands
  lines.push(pc.bold('Available Commands:'));
  
  const commandEntries: [string, string][] = [];
  const commandNames = Object.keys(config.commands);
  const maxNameLength = commandNames.length > 0 ? Math.max(...commandNames.map(name => name.length)) : 0;
  
  for (const [name, commandDef] of Object.entries(config.commands)) {
    let description = 'Loading...';
    
    // For non-lazy commands, get description directly
    if (typeof commandDef !== 'function') {
      description = commandDef.description;
    }
    
    commandEntries.push([name, description]);
  }
  
  // Sort commands alphabetically
  commandEntries.sort((a, b) => a[0].localeCompare(b[0]));
  
  for (const [name, description] of commandEntries) {
    const paddedName = name.padEnd(maxNameLength + 2);
    lines.push(`  ${paddedName}${description}`);
  }
  
  lines.push('');
  lines.push(`Run '${config.name} help [command]' for detailed information about a command.`);
  
  return lines.join('\n');
}

export async function formatAllExamples(commands: Record<string, Command | (() => Promise<Command>)>): Promise<string> {
  const lines: string[] = [];
  
  lines.push(pc.bold('Command Examples:'));
  lines.push('');
  
  for (const [name, commandDef] of Object.entries(commands)) {
    let command: Command;
    
    if (typeof commandDef === 'function') {
      command = await commandDef();
    } else {
      command = commandDef;
    }
    
    if (command.examples && command.examples.length > 0) {
      lines.push(pc.bold(name));
      for (const example of command.examples) {
        lines.push(`  ${example}`);
      }
      lines.push('');
    }
  }
  
  return lines.join('\n');
}