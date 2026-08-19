# merlin-cli

A TypeScript CLI framework for tools that are read by machines as often as by
people.

```bash
npm install @light-merlin-dark/merlin-cli
```

Node 20+, Bun, or Deno. Zero runtime dependencies. 85 KB, unminified, readable
in an afternoon.

---

## Your command already returns a value. That value becomes JSON.

Write a command the way you always would:

```ts
import { createCLI, createCommand, LoggerToken } from '@light-merlin-dark/merlin-cli';

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
    ctx.registry.get(LoggerToken).info('connecting to staging…');
    return { url: `https://${ctx.namedArgs.target}.example.com`, durationMs: 8120 };
  }
});

await createCLI({ name: 'mycli', version: '1.0.0', commands: { deploy } }).run();
```

A person gets what `render` says, and the log line goes to stderr where it
belongs:

```
$ mycli deploy staging
Deployed → https://staging.example.com

$ mycli deploy staging 2>/dev/null | cat
Deployed → https://staging.example.com
```

A machine asks for the same result in a shape it can parse — **no extra code,
no second code path**:

```
$ mycli deploy staging --json
{
  "ok": true,
  "code": 0,
  "command": "deploy",
  "data": {
    "url": "https://staging.example.com",
    "durationMs": 8120
  },
  "error": null,
  "cli": { "name": "mycli", "version": "1.0.0", "contract": "2.0" }
}
```

`data` is your return value. `ok` and `code` are the same fact as the process's
exit status, because all three are projections of one result — which is why they
cannot disagree.

Streaming works the same way. `ctx.emit(item)` gives you one NDJSON line per
item as it happens, envelope last, in constant memory over a million items:

```
$ mycli export --ndjson
{"id":1,"name":"first"}
{"id":2,"name":"second"}
{"ok":true,"code":0,"command":"export","data":null,"error":null,"cli":{…}}
```

This is why upgrading is cheap: 1.x commands already returned values — the
framework used them only to derive an exit code and then discarded them. **The
seven CLIs upgraded here gained `--json` on the day, without one command being
rewritten.**

## Every CLI can describe itself, completely, in one call

```
$ mycli manifest | jq -r '.commands[].name'
deploy
version
help
manifest
```

That is not a list of names scraped from `--help`. It is the whole surface:

```
$ mycli manifest | jq '.commands[] | select(.name == "deploy")'
{
  "name": "deploy",
  "description": "Deploy the current branch",
  "args": [
    { "name": "target", "type": "string", "description": "Environment",
      "required": true, "choices": ["staging", "prod"] }
  ],
  "options": [
    { "name": "force", "type": "boolean", "description": "Skip confirmation",
      "required": false, "alias": "f" },
    { "name": "tag", "type": "array", "description": "Extra tags",
      "required": false, "alias": "t" },
    { "name": "token", "type": "string", "description": "Auth token",
      "required": false, "env": "DEPLOY_TOKEN" }
  ],
  "examples": ["mycli deploy staging", "mycli deploy prod --force"],
  "exitCodes": [{ "code": 4, "meaning": "deployed with warnings" }]
}
```

Three properties make that useful rather than decorative:

- **It loads nothing.** Commands declared with `lazy()` carry their metadata
  inline, so a 500-command CLI answers `manifest` as fast as a 5-command one and
  imports none of the 500 modules.
- **It is deterministic.** Declaration order, stable keys, no environment
  leakage, byte-identical across runs — so `diff` of two manifests is a readable
  record of what changed about your CLI.
- **`help` is a projection of it.** The two cannot drift, because neither is
  hand-written. `mycli help deploy --json` returns exactly the subtree above.

### If you are an agent

Everything you need from a CLI built on this, without reading its source:

```bash
mycli manifest                  # every command, argument, option, example, exit code
mycli <command> --json          # one JSON document on stdout, always this shape
mycli <command> --ndjson        # one line per item, envelope last
echo $?                         # 0 ok · 1 failed · 2 called wrong · 130/143 interrupted
```

stdout is payload and nothing else. Commentary — every log level, progress,
prompts — is on stderr, as NDJSON events in machine mode. A prompt with no
terminal fails immediately with exit 2 and names the flag that would have
answered it, rather than hanging you forever.

## The promises are numbered, and each one has a test

[CONTRACT.md](CONTRACT.md) states what every CLI built on this guarantees, as
RFC-2119 clauses with identifiers: `TRUTH-1`, `STREAM-2`, `GRAM-4`, and 43
others.

**46 normative clauses. 92 tests. The conformance suite parses the contract and
fails the build if a clause has no test.** You cannot add a promise here without
adding the thing that proves it.

Those tests do not run against `src/`. They:

1. build the package with its own `build` script,
2. run `npm pack` and unpack the tarball,
3. write fixture CLIs importing the unpacked entry point,
4. spawn them under Node, Bun and Deno,
5. assert on the exit status and the bytes, as a shell sees them.

That shape is not taste. This package once shipped a 65 KB stub: a
`"sideEffects": false` flag let the bundler tree-shake the router and the
exit-code module out of the artifact while their names stayed in the export
list, and the source suite stayed green the whole time. Only the artifact is
evidence.

```bash
npm run test:conformance
```

`tests/conformance/conformance-report.json` lists every clause and the tests
covering it.

## And it is honest about what happened

The contract's correctness half. None of it needs per-command code.

### The exit code is derived, not written

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

The `logger.error` row is the one a framework cannot see from the return value:

```ts
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
```

```
$ mycli greet
[ERROR] Who am I greeting?
$ echo $?
1                        # not 0, though the command returned normally
```

Red text and `$? = 0` is how a CI job goes green on a failed deploy. This rule
applies to whatever logger is registered under `LoggerToken` — including one you
register yourself from `bootstrap`, long after `createCLI` returned. Your
logger's own methods, properties and `this` binding are untouched; it is
wrapped, not replaced. Opt out per CLI with `errorExitPolicy: 'off'`, never per
command.

Exit `2` earns its own row. "You called me wrong" and "I tried and failed" need
different fixes, and no caller should have to parse prose to tell them apart.

### Typos are errors, not silence

```
$ mycli deploy prod --forse
[ERROR] Unknown option: --forse. Run with --help to see the options this command accepts.
$ echo $?
2
```

`--forse` silently dropped is how a deploy skips its confirmation flag. The
grammar is written down — `--`, `--name=value`, `--no-name`, `-abc` bundling,
`-ovalue`, negative numbers as positionals, arrays that accumulate, `choices`,
`env:` fallbacks, and a fixed validation order — and a `number` option rejects
`--times lots` as a usage error rather than handing your command `NaN`.

Strictness is earned by declaring. A command that passes neither `args` nor
`options` keeps the permissive parsing it had.

### Ctrl-C is an API

Every command gets `ctx.signal`, aborted on SIGINT or SIGTERM, with a grace
period to clean up. Then the process leaves with 130 or 143 — and cleaning up
successfully does not turn an interrupt back into a success.

```ts
execute: async ({ signal }) => (await fetch(url, { signal })).json()
```

## Writing one

Services by token — no container, no decorators:

```ts
const ApiToken = createToken<ApiClient>('api');
cli.registry.register(ApiToken, new ApiClient());
// inside a command:
const api = ctx.registry.get(ApiToken);
```

`LoggerToken`, `PrompterToken` and `ConfigToken` are registered for you and can
be replaced with your own.

Commands that load on demand can still describe themselves:

```ts
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

Testing, in process and out:

```ts
const run = await runCLI({ name: 'mycli', version: '1.0.0', commands }, ['deploy', 'staging', '--json']);
run.code        // 0
run.data()      // the envelope's data, parsed
run.events()    // parsed NDJSON events from stderr
```

`runCLI` exercises the whole pipeline — grammar, validation, middleware,
rendering, exit resolution. `spawnCLI` runs a built script in a real subprocess
and reads the real exit status, which is the only way to catch a wrapper that
discards it. `createTestHarness`, `createMockLogger`, `createMockPrompter`,
`mockRegistry` and `runCommand` are all still here.

## How this compares

It is not trying to be a better argument parser.

- **commander** and **yargs** are the mature, ubiquitous choice for parsing
  argv and printing help. If that is the problem you have, use one of them.
- **oclif** is a large application framework — plugins, generators, an update
  channel, a big surface. If you are building something the size of the Heroku
  or Salesforce CLI, that is what it is for.
- **merlin-cli** is for the case where a CLI's output and exit status are
  consumed by something that cannot ask a follow-up question: a CI gate, a
  script, an agent. It is small on purpose — four imports cover almost every
  CLI (`createCLI`, `createCommand`, `createToken`, `LoggerToken`) — and what it
  adds instead of features is a written contract with tests against the shipped
  artifact.

Zero runtime dependencies is part of that bet. Every dependency is a decade of
someone else's release decisions; zero is the only number that needs no
monitoring.

## In production

Ten CLIs in this estate are built on it — Cloudflare administration, local DNS
and nginx management, Coolify deployment, browser automation, cost reporting.
Seven are on 2.0.

The largest, `cf-cli`, has 364 tests and they passed before and after the
upgrade without a source change. `local-dns` deleted its hand-written help
screen and its hand-maintained command list in the process, and went from 52
passing / 3 failing to 57 passing / 0.

## Upgrading from 1.x

[MIGRATING.md](MIGRATING.md) is the working procedure — nine steps, written
while migrating those CLIs, naming what actually went wrong in them. It ships
inside the package, so in any project that already installed this you can read
it at `node_modules/@light-merlin-dark/merlin-cli/MIGRATING.md`.

Every export published in 1.2.0 still resolves; a conformance test checks the
2.0 surface against the real published one. Seven behaviours changed:

| # | Change | Who notices | Fix |
|---|---|---|---|
| 1 | `logger.info/success/warn/debug` → **stderr** | anything parsing your stdout for log lines | read stderr, or `--json` |
| 2 | undeclared option on a declared command → exit 2 | typos that used to pass silently | declare it |
| 3 | unknown command → exit 2 (was 1) | scripts branching on `$? -eq 1` | branch on 2 |
| 4 | prompts fail fast when non-interactive | CI jobs that currently hang | this is the fix; add a `fallbackFlag` |
| 5 | `version` prints `<name> <version>` | scripts parsing `v1.2.3` | usually a shorter parse |
| 6 | `json` / `ndjson` / `manifest` reserved | a command that already defines them | it keeps them; declare the option |
| 7 | `cli.run()` exits on success too | code after `await cli.run()` | move it before, or `exitProcess: false` |

`ctx.args` is still a `string[]`. Typed positionals arrive on `ctx.namedArgs`,
because redefining `ctx.args` would have broken every command in every consumer,
and not breaking a consumer outranks every other value in this repository.

## License

MIT
