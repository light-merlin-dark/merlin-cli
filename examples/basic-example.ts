#!/usr/bin/env bun
import { createCLI, createCommand } from '../src/index.ts';

const cli = createCLI({
  name: 'example-cli',
  version: '1.0.0',
  description: 'A simple example CLI',
  commands: {
    greet: createCommand({
      name: 'greet',
      description: 'Greet someone',
      examples: [
        'greet World',
        'greet "John Doe" --excited',
        'greet Alice --times 3'
      ],
      options: {
        excited: {
          type: 'boolean',
          description: 'Add excitement to the greeting'
        },
        times: {
          type: 'number',
          description: 'Number of times to greet',
          default: 1
        }
      },
      execute: ({ args, options }) => {
        const name = args[0] || 'World';
        const greeting = options.excited ? `Hello ${name}!!!` : `Hello ${name}`;
        
        for (let i = 0; i < options.times; i++) {
          console.log(greeting);
        }
      }
    }),

    echo: createCommand({
      name: 'echo',
      description: 'Echo the input',
      examples: [
        'echo "Hello World"',
        'echo test --uppercase'
      ],
      options: {
        uppercase: {
          type: 'boolean',
          description: 'Convert to uppercase'
        }
      },
      execute: ({ args, options }) => {
        const text = args.join(' ');
        console.log(options.uppercase ? text.toUpperCase() : text);
      }
    })
  }
});

// Run the CLI
cli.run().catch(console.error);