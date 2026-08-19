# merlin-cli

A small TypeScript CLI framework for tools that are read by machines as often as
by people.

```bash
npm install @light-merlin-dark/merlin-cli
```

Requires Node 20+. Works under Bun and Deno. Zero runtime dependencies.

Every command you write gets, without any per-command code:

- an **exit code that matches what it told the user** — including the case where
  it printed an error and returned normally
- **`--json` and `--ndjson`**, built from the value the command already returns
- a **`manifest` command** that describes the whole CLI in one deterministic call
- **stdout for payload, stderr for commentary**, so `mycli export | jq` works
- **prompts that fail fast instead of hanging** a CI job or an agent
- **Ctrl-C that exits 130**, after giving the command a chance to clean up

What each of those means precisely is written down in
[CONTRACT.md](CONTRACT.md), as numbered clauses. Every clause that says MUST has
a test in [`tests/conformance/`](tests/conformance/) that runs against the
packed tarball in a real subprocess, and the suite fails the build if a clause
has no test.

## Quick start

```ts
import { createCLI, createCommand, LoggerToken } from '@light-merlin-dark/merlin-cli';

const greet = createCommand({
  name: 'greet',
  description: 'Greet someone by name',
  execute: (ctx) => {
    const logger = ctx.registry.get(LoggerToken);
    const name = ctx.args[0];
    if (!name) { logger.error('Who am I greeting?'); return; }
    logger.success(`Hello, ${name}!`);
  }
});

await createCLI({ name: 'mycli', version: '1.0.0', commands: { greet } }).run();
```

```
$ mycli greet merlin
[SUCCESS] Hello, merlin!          # stderr — commentary
$ echo $?
0

$ mycli greet
[ERROR] Who am I greeting?
$ echo $?
1                                 # not 0, even though the command returned normally
```

That last line is the whole point of the first version of this framework, and it
is unchanged. The rest of this page is what 2.0 adds on top of it.

## The exit code is derived, not written

| Your command | Exit code |
|---|---|
| returns `undefined`, data, a string, an array | `0` |
| returns `{ success: true }` | `0` |
| returns `{ success: false }` | `1` |
| returns `{ exitCode: n }` | `n` |
| throws | `1` |
| **calls `logger.error(...)`, whatever it returns** | `1` |
| was called wrong — unknown command, bad option, missing argument | `2` |
| was interrupted | `130` (SIGINT) or `143` (SIGTERM) |

The `logger.error` row is the one other frameworks cannot see, because it is not
in the return value. It applies to whatever logger is registered under
`LoggerToken` — including one you register yourself, from `bootstrap`, long
after `createCLI` returned. Your logger's own methods, properties and `this`
binding are untouched; it is wrapped, not replaced.

Exit `2` is worth its own mention. "You called me wrong" and "I tried and
failed" need different fixes, and a caller should not have to read prose to tell
them apart.

Need a command that reports a non-fatal error and still succeeds? Opt out per
CLI, never per command:

```ts
createCLI({ name: 'mycli', version: '1.0.0', errorExitPolicy: 'off', commands })
```

Usually you don't want that. If one line is a warning dressed as an error, make
it `logger.warn`.

## One result, several renderings

A command computes a result and returns it. What an observer sees is a
projection of that one result — and so is the exit code, which is why they
cannot disagree.

```ts
const deploy = createCommand({
  name: 'deploy',
  description: 'Deploy the current branch',
  args: { target: { type: 'string', required: true, choices: ['staging', 'prod'],
                    description: 'Environment' } },
  options: {
    force: { type: 'boolean', description: 'Skip confirmation', alias: 'f' },
    tag:   { type: 'array',   description: 'Extra tags', alias: 't' },
    token: { type: 'string',  description: 'Auth token', env: 'DEPLOY_TOKEN' }
  },
  examples: ['mycli deploy staging', 'mycli deploy prod --force'],
  exitCodes: { 4: 'deployed with warnings' },
  render: (data) => `Deployed → ${data.url}`,
  execute: async (ctx) => {
    const result = await doDeploy(ctx.namedArgs.target, { signal: ctx.signal });
    return { url: result.url, durationMs: result.ms };
  }
});
```

```
$ mycli deploy staging
Deployed → https://staging.example.com

$ mycli deploy staging --json
{
  "ok": true,
  "code": 0,
  "command": "deploy",
  "data": { "url": "https://staging.example.com", "durationMs": 8120 },
  "error": null,
  "cli": { "name": "mycli", "version": "1.0.0", "contract": "2.0" }
}
```

`data` is the return value minus the keys used to signal outcome (`success`,
`exitCode`, `error`). It is the only application-shaped field in the envelope.

Because 1.x commands already returned values — they were used only to derive the
exit code — **most existing commands gain `--json` with no changes at all.**

### Streaming

```ts
execute: ({ emit }) => { for (const row of rows) emit(row); }
```

```
$ mycli export --ndjson
{"id":1,"name":"first"}
{"id":2,"name":"second"}
{"ok":true,"code":0,"command":"export","data":null,"error":null,"cli":{…}}
```

One line per item as it happens, envelope last. Constant memory over a million
items.

### A command that already owns `--json`

If your command declares an option named `json` or `ndjson`, it keeps its own
meaning and the framework's mode is disabled for that invocation. The manifest
records the shadowing. Nothing that already worked stops working.

## Self-description

```
$ mycli manifest | jq '.commands[].name'
```

One deterministic call returns every command and subcommand, with descriptions,
aliases, arguments, options, environment fallbacks, examples and documented exit
codes. No implementation is loaded to produce it, so it costs the same on a CLI
with five hundred commands as on one with five.

`help` is a projection of the same data, so the two cannot drift. `mycli help
deploy --json` returns exactly the manifest's subtree for `deploy`.

Commands that load on demand can still describe themselves:

```ts
import { lazy } from '@light-merlin-dark/merlin-cli';

commands: {
  migrate: lazy({
    name: 'migrate',
    description: 'Run pending migrations',
    aliases: ['m'],
    load: () => import('./commands/migrate.ts').then(m => m.default)
  })
}
```

Help, the manifest and alias resolution read the declaration; the module loads
on first execution only.

## Streams

stdout carries payload. stderr carries everything else — every logger level
including `info` and `success`, plus progress and prompts.

```bash
mycli export > data.json     # just the data
mycli export 2> run.log      # just the commentary
mycli export | jq .          # works
```

In `--json` and `--ndjson` mode the framework also relays anything a command
writes to stdout directly, as `{"ev":"out","text":"…"}` on stderr, so a stray
`console.log` deep in a helper cannot corrupt the document a caller is parsing.

## The grammar

```
--                 ends option parsing; the rest is positional, verbatim
--name=value       same as --name value
--name             sets a declared boolean true
--no-name          sets a declared boolean false
-abc               bundles declared boolean shorts
-o value, -ovalue  binds a declared value-taking short
-2, -0.5           positional, when no such short option is declared
```

Options and positionals may interleave. Values are coerced to the declared type;
a `number` option rejects `--times lots` as a usage error rather than passing
`NaN` to your command. An `array` option accumulates across repeats.

For a command that declares `args` or `options`, an **undeclared option is a
usage error** — `--forse` should not silently skip the confirmation it was meant
to set. Commands that declare neither keep the permissive parsing they had.

## Prompts never hang

```ts
const prompter = ctx.registry.get(PrompterToken);
if (!await prompter.confirm('Delete production?')) return;
```

With a terminal, that asks. Without one — in CI, in a pipeline, under an agent —
it fails immediately:

```
[ERROR] Cannot prompt without an interactive terminal: "Delete production?".
        Re-run with --yes to answer it without a terminal.
$ echo $?
2
```

Name the flag when you build the prompter and every caller gets a mechanical
fix:

```ts
registry.register(PrompterToken, createPrompter({ fallbackFlag: '--yes' }));
```

## Cancellation

Every command receives `ctx.signal`, aborted on SIGINT or SIGTERM. You get a
grace period (3 s by default, `gracePeriodMs` to change it) to clean up, then
the process leaves with 130 or 143. Cleaning up successfully does not turn an
interrupt into a success.

```ts
execute: async ({ signal }) => {
  const response = await fetch(url, { signal });
  return response.json();
}
```

## Services

Dependency injection by token — no container, no decorators.

```ts
import { createToken } from '@light-merlin-dark/merlin-cli';

const ApiToken = createToken<ApiClient>('api');

cli.registry.register(ApiToken, new ApiClient());
// then, inside a command:
const api = ctx.registry.get(ApiToken);
```

`LoggerToken`, `PrompterToken` and `ConfigToken` are registered for you and can
be replaced with your own.

## Testing

```ts
import { runCLI, spawnCLI } from '@light-merlin-dark/merlin-cli';

const run = await runCLI({ name: 'mycli', version: '1.0.0', commands }, ['deploy', 'staging', '--json']);
run.code            // 0
run.data()          // the envelope's data, parsed
run.stderr          // commentary
run.events()        // parsed NDJSON events
```

`runCLI` exercises the whole pipeline in process — grammar, validation,
middleware, rendering, exit resolution. `spawnCLI` runs a built script in a real
subprocess and reads the real exit status, which is the only way to catch a
wrapper that discards it. `createTestHarness`, `createMockLogger`,
`createMockPrompter`, `mockRegistry` and `runCommand` are all still here.

## The contract, and how it is enforced

[CONTRACT.md](CONTRACT.md) is not a summary of the code; the code is checked
against it. The conformance suite:

1. builds the package with its own `build` script,
2. runs `npm pack` and unpacks the tarball,
3. writes fixture CLIs that import the unpacked entry point,
4. spawns them under plain Node and under Bun,
5. asserts on the exit status and the bytes, as a shell would see them.

That shape is not architectural taste. This package once shipped a 65 KB stub: a
`"sideEffects": false` flag let the bundler tree-shake the router and the
exit-code module out of the artifact while their names stayed in the export
list, and the source suite stayed green throughout. Only the artifact is
evidence.

```bash
npm run test:conformance
```

`tests/conformance/conformance-report.json` lists every clause and the tests
covering it.

## Upgrading from 1.x

Every 1.2.0 export still resolves, and there is a conformance test that checks
it against the published surface. Seven behaviours changed:

| # | Change | Who notices | Fix |
|---|---|---|---|
| 1 | `logger.info/success/warn/debug` now go to **stderr** | anything parsing your CLI's stdout for log lines | read stderr, or `--json` |
| 2 | undeclared option on a declared command → exit 2 | typos that used to pass silently | fix the typo, or declare the option |
| 3 | unknown command → exit 2 (was 1) | scripts branching on `$? -eq 1` | branch on 2 |
| 4 | prompts fail fast when non-interactive | CI jobs that currently hang forever | this is the fix; add a `fallbackFlag` |
| 5 | `version` prints `<name> <version>` (was `v<version>`) | scripts parsing it | usually a shorter parse |
| 6 | `--json` / `--ndjson` / `manifest` are reserved | a command that already defines them | it keeps them; declare the option to be explicit |
| 7 | `cli.run()` exits the process on success too | code after `await cli.run()` | move it before, or set `exitProcess: false` |

Not breaking, and worth knowing: your commands' existing return values become
`--json` payloads with no code changes, `ctx.args` is still a `string[]`, and
every `logger.error` site keeps failing the command exactly as it did.

## License

MIT
