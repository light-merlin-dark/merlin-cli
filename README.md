# merlin-cli

A small TypeScript CLI framework that **exits non-zero when your command fails.**

That sounds like a low bar. It is. Most CLI frameworks clear it only if you
remember to clear it yourself, in every command, every time — and when you
forget, the failure is invisible to everything above you.

```bash
npm install @light-merlin-dark/merlin-cli
```

Requires Node 20+. Works under Bun.

## The problem it solves

Here is a command that reports a failure. Under most frameworks, it exits `0`:

```ts
execute: (ctx) => {
  const zone = findZone(ctx.args[0]);
  if (!zone) {
    ctx.registry.get(LoggerToken).error('Zone not found');
    return;                       // prints an error, tells the shell it worked
  }
  ...
}
```

The user sees red text and assumes it failed. `$?` is `0`. So the `&&` in the
next line of the script runs anyway, CI goes green, and an agent reading the
exit code reports success. The error message and the exit code disagree, and
only one of them is machine-readable.

merlin-cli treats **both** channels as real:

| Your command | Exit code |
|---|---|
| returns `undefined`, data, a string, an array | `0` |
| returns `{ success: true }` | `0` |
| returns `{ success: false }` | `1` |
| returns `{ exitCode: n }` | `n` |
| throws | `1` |
| **calls `logger.error(...)`, whatever it returns** | `1` |

That last row is the one other frameworks can't see, because it isn't in the
return value. If a command told the user it failed, it failed.

Need a command that reports a non-fatal error and still succeeds? Opt out
explicitly, per CLI:

```ts
createCLI({ name: 'mycli', version: '1.0.0', errorExitPolicy: 'off', commands })
```

## Quick start

```ts
#!/usr/bin/env node
import { createCLI, createCommand, LoggerToken } from '@light-merlin-dark/merlin-cli';

const greet = createCommand({
  name: 'greet',
  description: 'Greet someone by name',
  execute: (ctx) => {
    const logger = ctx.registry.get(LoggerToken);
    const name = ctx.args[0];

    if (!name) {
      logger.error('Who am I greeting?');
      return;                     // exits 1 — no boilerplate required
    }

    logger.success(`Hello, ${name}!`);
  }
});

await createCLI({
  name: 'mycli',
  version: '1.0.0',
  commands: { greet }
}).run();
```

```console
$ mycli greet merlin
[SUCCESS] Hello, merlin!
$ echo $?
0

$ mycli greet
[ERROR] Who am I greeting?
$ echo $?
1
```

`help` and `version` are registered for you.

## The API

Eleven exports, and you will mostly use four.

### `createCLI(config)`

Builds the CLI. `run(args?)` routes `process.argv.slice(2)` by default and
resolves with the exit code it derived.

```ts
const cli = createCLI({
  name: 'mycli',
  version: '1.0.0',
  description: 'What this tool does',
  commands: { greet, deploy },

  // Optional
  defaultCommand: 'greet',        // used when argv[0] matches no command
  errorExitPolicy: 'strict',      // 'off' to ignore logger.error (default 'strict')
  exitProcess: true,              // false to resolve the code without exiting
  middleware: [timing],
  onError: async (err, ctx) => { /* report it; the command still fails */ }
});

await cli.run();
```

Set `exitProcess: false` when you own the process lifecycle — embedding the CLI,
or testing it. `run()` then returns the code instead of exiting.

### `createCommand(spec)`

```ts
const deploy = createCommand({
  name: 'deploy',
  description: 'Deploy the current branch',
  aliases: ['d'],
  args: { target: { type: 'string', required: true, description: 'Environment' } },
  options: { force: { type: 'boolean', description: 'Skip confirmation' } },
  examples: ['mycli deploy staging', 'mycli deploy prod --force'],
  execute: async (ctx) => {
    // ctx.args     — positional arguments
    // ctx.options  — parsed flags
    // ctx.registry — service registry
  }
});
```

Declared `args` and `options` are validated before `execute` runs.

### `createToken(key)` and the registry

Dependency injection with no container and no decorators. A token is a typed key.

```ts
import { createToken } from '@light-merlin-dark/merlin-cli';

const ApiToken = createToken<ApiClient>('api');

const cli = createCLI({ /* ... */ });
cli.registry.register(ApiToken, new ApiClient(process.env.API_KEY));

// Inside any command — the type comes back with it:
const api = ctx.registry.get(ApiToken);
```

Built in: `LoggerToken`, `PrompterToken`, `ConfigToken`.

```ts
const logger = ctx.registry.get(LoggerToken);
logger.info('...'); logger.success('...'); logger.warn('...');
logger.debug('...');   // only with --verbose
logger.error('...');   // also fails the command

const prompter = ctx.registry.get(PrompterToken);
if (await prompter.confirm('Deploy to production?')) { /* ... */ }
```

### Subcommands and lazy loading

Nest commands, and load them only when called — startup stays flat as the CLI grows:

```ts
const cli = createCLI({
  name: 'mycli',
  version: '1.0.0',
  commands: {
    dns: {
      name: 'dns',
      description: 'Manage DNS records',
      subcommands: {
        add:  { name: 'add',  description: 'Add a record',  execute: addRecord },
        list: { name: 'list', description: 'List records', execute: listRecords }
      }
    },
    // Imported on first use, not at startup
    migrate: () => import('./commands/migrate.js').then(m => m.default)
  }
});
```

### Testing

```ts
import { createTestHarness } from '@light-merlin-dark/merlin-cli';

const harness = createTestHarness({ greet });
await harness.runCommand('greet', ['merlin']);
expect(harness.getOutput()).toContain('Hello, merlin!');
```

`createMockLogger`, `createMockPrompter` and `mockRegistry` are also exported.

### Also exported

`colors` and `createProgress` for terminal output, `createLogger` and
`createPrompter` to build services yourself, `CommandRouter`, `ServiceRegistry`,
and `resolveExitCode` if you want the exit-code rule without the framework.

Types: `Command`, `CommandDefinition`, `CommandContext`, `OptionSpec`, `ArgSpec`,
`CLIConfig`, `Middleware`, `Logger`, `Prompter`, `Token`.

## Why the tests look the way they do

`tests/conformance/` runs against the **built artifact** in a real child
process — it packs the tarball, unpacks it, imports it under plain Node, and
asserts on the process exit status a shell would actually see.

That is not belt-and-braces. This package once shipped a 65 KB stub: a
`"sideEffects": false` flag let the bundler tree-shake the router, the CLI
entry point and the exit-code module out of the bundle while leaving their
names in the export list. The build exited `0`. The source test suite was
green. Every test passed against code that wasn't in the box.

A green source suite is not evidence about a tarball, and a return value
inside a test runner is not evidence about an exit code. So the tests assert
the artifact.

## Contributing

Issues and pull requests are welcome.

```bash
bun install
bun test                  # everything
bun run test:conformance  # the artifact-level contract
```

If you change behaviour a consumer can observe, add the assertion to
`tests/conformance/` — that directory is the contract.

## License

MIT © Robert E. Beckner III
