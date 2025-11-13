import { createCommand } from '../create-command.ts';
import type { Command, HelpOptions } from '../../types/index.ts';
import { formatCommandHelp, formatGeneralHelp, formatAllExamples } from '../../utils/help-formatter.ts';

export interface HelpCommandOptions {
  name: string;
  commands: Record<string, Command | (() => Promise<Command>)>;
  options?: HelpOptions;
}

export function createHelpCommand(config: HelpCommandOptions): Command<string> {
  return createCommand({
    name: 'help',
    description: 'Show help information',
    usage: 'help [command]',
    examples: [
      'help              # Show general help',
      'help add          # Show help for specific command',
      'help --examples   # Show all command examples',
      'help --json       # Output help as JSON'
    ],
    options: {
      examples: {
        type: 'boolean',
        description: 'Show practical examples for all commands'
      },
      json: {
        type: 'boolean',
        description: 'Output help in JSON format'
      }
    },

    execute: async ({ args, options }) => {
      if (args.length > 0) {
        // Show help for specific command or subcommand
        let command = config.commands[args[0]];
        let commandPath = [args[0]];

        if (!command) {
          throw new Error(`Unknown command: ${args[0]}`);
        }

        // Resolve lazy-loaded command if needed
        if (typeof command === 'function') {
          command = await command();
        }

        // Navigate to subcommand if specified
        for (let i = 1; i < args.length; i++) {
          if (command.subcommands && command.subcommands[args[i]]) {
            command = command.subcommands[args[i]];
            commandPath.push(args[i]);
          } else {
            throw new Error(`Unknown subcommand '${args[i]}' for command '${commandPath.join(' ')}'`);
          }
        }

        const output = formatCommandHelp(command, {
          ...config.options,
          format: options.json ? 'json' : config.options?.format
        });
        console.log(output);
        return output;
      }

      // Show general help
      if (options.examples) {
        const output = await formatAllExamples(config.commands);
        console.log(output);
        return output;
      }

      const output = await formatGeneralHelp(config);
      console.log(output);
      return output;
    }
  });
}