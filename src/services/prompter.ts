import prompts from 'prompts';
import type { Prompter } from '../types/index.ts';

export { type Prompter };

export function createPrompter(): Prompter {
  // Check if we're in a non-interactive environment
  const isNonInteractive = process.env.CI || process.argv.includes('--no-interaction');

  return {
    confirm: async (message, initial = false) => {
      if (isNonInteractive) {
        throw new Error(`Cannot prompt for confirmation in non-interactive mode: ${message}`);
      }

      const { value } = await prompts({
        type: 'confirm',
        name: 'value',
        message,
        initial
      });
      return value;
    },

    text: async (message, initial = '') => {
      if (isNonInteractive) {
        throw new Error(`Cannot prompt for text in non-interactive mode: ${message}`);
      }

      const { value } = await prompts({
        type: 'text',
        name: 'value',
        message,
        initial
      });
      return value;
    },

    select: async (message, choices) => {
      if (isNonInteractive) {
        throw new Error(`Cannot prompt for selection in non-interactive mode: ${message}`);
      }

      const { value } = await prompts({
        type: 'select',
        name: 'value',
        message,
        choices
      });
      return value;
    },

    multiselect: async (message, choices) => {
      if (isNonInteractive) {
        throw new Error(`Cannot prompt for multi-selection in non-interactive mode: ${message}`);
      }

      const { value } = await prompts({
        type: 'multiselect',
        name: 'value',
        message,
        choices
      });
      return value || [];
    },

    ask: async (questions) => {
      if (isNonInteractive) {
        throw new Error('Cannot run prompts in non-interactive mode');
      }
      return prompts(questions);
    }
  };
}