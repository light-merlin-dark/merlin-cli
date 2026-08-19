import { createInterface } from 'node:readline';
import type { Prompter } from '../types/index.ts';
import { UsageError, EXIT_CODE } from '../core/errors.ts';
import { currentOutput } from '../core/output.ts';
import { createStyler } from '../utils/colors.ts';

export { type Prompter };

/**
 * Interactive prompts, over `node:readline` rather than a dependency.
 *
 * Two rules do the real work here:
 *
 * - A prompt with nothing to read from fails immediately instead of blocking.
 *   Hanging forever is the single most common way a CLI ruins a CI job or an
 *   agent's day, and "it hung" carries no information; exit 2 with the question
 *   and the flag that would have answered it carries all of it.
 * - The question goes to stderr and is read from stdin's terminal, so
 *   redirecting stdout never captures a prompt and piping stdin never silently
 *   answers one.
 */

export interface PromptOptions {
  /** Flag a caller could pass instead of answering, named in the error. */
  fallbackFlag?: string;
}

export interface PrompterOptions extends PromptOptions {
  /** Force non-interactive behaviour regardless of the environment. */
  interactive?: boolean;
}

function interruptedError(): Error {
  const error = new Error('Prompt cancelled');
  (error as unknown as Record<symbol, unknown>)[EXIT_CODE] = 130;
  return error;
}

export function createPrompter(defaults: PrompterOptions = {}): Prompter {
  const palette = createStyler(process.stderr);

  const isInteractive = (): boolean => {
    if (defaults.interactive !== undefined) return defaults.interactive;
    // Machine mode implies non-interactive: an envelope that stops mid-stream
    // to ask a question is not an envelope.
    if (currentOutput()?.isMachine) return false;
    if (process.env.CI) return false;
    if (process.argv.includes('--no-interaction')) return false;
    return Boolean(process.stdin.isTTY);
  };

  const refuse = (question: string, options?: PromptOptions): never => {
    const flag = options?.fallbackFlag ?? defaults.fallbackFlag;
    const remedy = flag
      ? ` Re-run with ${flag} to answer it without a terminal.`
      : ' Provide the answer as an option instead, or run it with a terminal attached.';
    throw new UsageError(`Cannot prompt without an interactive terminal: "${question}".${remedy}`);
  };

  const ask = async (question: string, options?: PromptOptions): Promise<string> => {
    if (!isInteractive()) refuse(question, options);

    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });

    try {
      return await new Promise<string>((resolve, reject) => {
        rl.question(question, answer => resolve(answer));
        rl.once('close', () => reject(interruptedError()));
      });
    } finally {
      rl.close();
    }
  };

  const listChoices = (choices: Array<{ title: string }>): string =>
    choices.map((choice, index) => `  ${palette.gray(String(index + 1))}) ${choice.title}`).join('\n');

  return {
    async confirm(message, initial = false) {
      const hint = initial ? 'Y/n' : 'y/N';
      const answer = (await ask(`${message} (${hint}) `, defaults)).trim().toLowerCase();
      if (answer === '') return initial;
      return answer === 'y' || answer === 'yes';
    },

    async text(message, initial = '') {
      const hint = initial ? ` (${initial})` : '';
      const answer = await ask(`${message}${hint} `, defaults);
      return answer.trim() === '' ? initial : answer;
    },

    async select(message, choices) {
      if (choices.length === 0) throw new UsageError(`Nothing to choose from: ${message}`);
      if (!isInteractive()) refuse(message, defaults);

      process.stderr.write(`${message}\n${listChoices(choices)}\n`);
      const answer = await ask(`Enter a number (1-${choices.length}): `, defaults);
      const index = Number(answer.trim()) - 1;

      if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
        throw new UsageError(`'${answer.trim()}' is not one of 1-${choices.length}.`);
      }
      return choices[index].value;
    },

    async multiselect(message, choices) {
      if (choices.length === 0) return [];
      if (!isInteractive()) refuse(message, defaults);

      process.stderr.write(`${message}\n${listChoices(choices)}\n`);
      const answer = await ask(`Enter numbers separated by commas (blank for none): `, defaults);
      const trimmed = answer.trim();
      if (trimmed === '') return [];

      return trimmed.split(',').map(part => {
        const index = Number(part.trim()) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
          throw new UsageError(`'${part.trim()}' is not one of 1-${choices.length}.`);
        }
        return choices[index].value;
      });
    },

    async ask(questions) {
      const list = Array.isArray(questions) ? questions : [questions];
      const answers: Record<string, unknown> = {};

      for (const question of list as Array<Record<string, any>>) {
        const message = String(question.message ?? question.name);

        switch (question.type) {
          case 'confirm':
            answers[question.name] = await this.confirm(message, question.initial);
            break;
          case 'select':
            answers[question.name] = await this.select(message, question.choices ?? []);
            break;
          case 'multiselect':
            answers[question.name] = await this.multiselect(message, question.choices ?? []);
            break;
          case 'number': {
            const raw = await this.text(message, question.initial === undefined ? '' : String(question.initial));
            const value = Number(raw);
            if (!Number.isFinite(value)) throw new UsageError(`'${raw}' is not a number.`);
            answers[question.name] = value;
            break;
          }
          default:
            answers[question.name] = await this.text(message, question.initial ?? '');
        }
      }

      return answers;
    }
  };
}
