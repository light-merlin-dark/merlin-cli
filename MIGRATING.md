# Migrating a CLI from merlin-cli 1.x to 2.0

This is a working procedure, not a summary. It was written while migrating real
CLIs and it names the specific things that went wrong in them.

Read it in the repository you are migrating. If you installed this package, it
is already there:

```bash
cat node_modules/@light-merlin-dark/merlin-cli/MIGRATING.md
```

**Budget:** 20–60 minutes for a typical CLI. Most of that is step 3.

**The one rule:** a consumer's own test suite passing before and after is the
acceptance gate — not this framework's tests, and not the absence of type
errors. Record the baseline before you change anything.

---

## 0. Do you have to migrate?

No. `^1.2.0` does not resolve to 2.0.0, so a pinned CLI keeps working
untouched, indefinitely. Migrate the CLIs you use daily and leave the rest.

What you get for the work:

- `--json` and `--ndjson` on every command, mostly from return values your
  commands already produce
- `manifest`: the whole surface in one call, so an agent can learn the tool
  without a skill file or a scraped `--help`
- log lines out of stdout, so `yourcli export | jq` works
- typos in options caught instead of silently dropped
- prompts that fail fast instead of hanging CI
- exit 2 for "you called me wrong", distinct from exit 1 for "I tried and failed"

---

## 1. Record the baseline

Before touching anything:

```bash
bun test 2>&1 | tail -5      # or npm test
npx tsc --noEmit 2>&1 | tail -5
```

Write down the numbers. A suite that already fails 3 tests is fine; a suite that
fails 4 afterwards is the signal. **Do not skip this** — two of the CLIs
migrated so far had pre-existing failures, and without the baseline the
migration looks like the cause.

## 2. Bump and install

```bash
npm pkg set dependencies.@light-merlin-dark/merlin-cli=^2.0.1
npm install
npm ls @light-merlin-dark/merlin-cli    # confirm it actually moved
```

`npm install` alone sometimes leaves the old version in place when the lockfile
pins it. Check the output of `npm ls`; if it still says 1.x, run
`npm install @light-merlin-dark/merlin-cli@^2.0.1`.

**If your CLI bundles the framework into its own `dist`** — check whether your
`build` script runs `bun build` or `esbuild` over `src` — then swapping
`node_modules` changes nothing until you rebuild. Run your build before testing
the binary, or you will be testing 1.x and concluding everything is fine.

## 3. Find the options your commands read but never declared

This is the bulk of the work, and the framework can tell you the answer.

An undeclared option on a command that declares `args` or `options` is now a
usage error. That is the point — `--forse` silently dropped is how a deploy
skips its confirmation flag — but it means every flag your commands read has to
be written down.

The manifest is the ground truth for what is declared:

```bash
bun src/index.ts manifest > /tmp/manifest.json     # or: node bin/yourcli manifest
```

Then compare against what the source actually reads. Grep is enough:

```bash
grep -rhoE "options\.[A-Za-z]\w*|options\['[^']+'\]" src/commands | sort -u
```

Anything read but not in the manifest needs an entry:

```ts
options: {
  'dry-run': { type: 'boolean', description: 'Show what would change', default: false },
  'proxy-host': { type: 'string', description: 'Upstream host to proxy to' },
}
```

Types are inferable from use: `if (options.x)` is a boolean, `options.x.split()`
or a value passed onward is a string, arithmetic is a number.

**Do not** try to shortcut this by writing your own scanner over the source. One
was written for this and reported a dozen false positives, because keys inside
`execute` bodies look exactly like option declarations. The manifest is
authoritative; use it.

### The escape hatch, and when it is the wrong answer

```ts
createCLI({ …, strictOptions: 'off' })
```

This is correct when a command deliberately accepts arbitrary flags and passes
them through. It is the wrong answer for "declaring them all is tedious",
because then help and the manifest keep describing a surface your CLI does not
have — which is the thing 2.0 exists to stop.

## 4. Decide what `--json` means in your CLI

If any command already prints its own JSON:

```ts
if (options.json) { console.log(JSON.stringify(rows, null, 2)); return; }
```

…you have two options.

**Keep your shape (recommended for anything with scripted callers).** Declare
`json` as an option on that command:

```ts
options: { json: { type: 'boolean', description: 'Output the result as JSON', default: false } }
```

A command that declares `json` keeps its own meaning; the framework's mode is
disabled for that invocation and your output is unchanged, byte for byte.

**Adopt the envelope.** Delete the printing, return the data, and let `--json`
produce `{ok, code, command, data, error, cli}`. Better for new callers, but it
changes the shape for existing ones — so only where you know who is parsing it.

Either way, do it deliberately. If you leave a command printing JSON *and* do
not declare the option, `--json` produces the envelope on stdout and relays your
JSON to stderr as `{"ev":"out","text":"…"}` events. Nothing is lost, but nothing
downstream will like it.

## 5. Remove any gate in front of the router

Both CLIs migrated so far had one, and both were broken by it in the same way.

Look in your entry point for a hand-maintained list of command names, or a
hand-written help screen printed before `cli.run()`:

```ts
const validCommands = ['add', 'list', 'remove', …];
if (!validCommands.includes(command)) { showHelp(); process.exit(1); }
```

That list will reject `manifest` — and possibly `version` — as unknown
commands, because the framework registers them and your list does not know. It
is also a second copy of your command set, which is why it had drifted in both
CLIs.

Either delete the gate and let the framework route (help is generated from the
same declarations the manifest exposes, so it cannot drift), or, if the gate
earns its keep — cf-cli resolves help before routing so `cf token` stays
readable on a machine with no token configured — let the reserved names fall
through:

```ts
const RESERVED = new Set(['manifest']);
if (RESERVED.has(name) && !commands[name]) return null;   // let the router answer
```

## 6. Check the exit path

Three things to look for in your entry point and your `onError` hook:

**`process.exit(1)` inside `onError`** flattens 2 and 1 into one code a caller
cannot branch on. Delete it; the framework resolves the right code. If you need
to know which kind of failure it was:

```ts
import { isUsageError } from '@light-merlin-dark/merlin-cli';

onError: async (error, context) => {
  if (isUsageError(error)) { /* print the command's help behind the message */ }
}
```

**String-matching on framework error messages.** cf-cli keyed on
`message.startsWith('Validation errors:')` to decide whether to print help. 2.0
rephrases those messages, so the branch went dead silently. Use `isUsageError`.

**Code after `await cli.run()`.** `run()` now exits the process on success too,
so that a stray `setInterval` cannot keep a finished CLI alive. Move the work
before the call, or pass `exitProcess: false` and exit yourself.

## 7. Re-run, and read the diff against your baseline

```bash
bun test 2>&1 | tail -5
npx tsc --noEmit 2>&1 | tail -5
```

Compare to step 1. Then exercise the binary itself, because a test suite that
imports `src` cannot see a wrapper that discards the exit code:

```bash
yourcli version                       # <name> <version>, nothing else
yourcli manifest | jq '.commands[].name'
yourcli nonexistent; echo $?          # 2
yourcli somecommand --typpo; echo $?  # 2, naming the flag
yourcli somecommand | jq .            # no log lines in the payload
```

## 8. Update the tests that encoded the old behaviour

Expect a handful. These are not regressions; they are assertions about things
that deliberately changed. The ones seen so far:

| Assertion | Now |
|---|---|
| unknown command exits `1` | `2` |
| `version` prints `v1.2.3` | `yourcli 1.2.3` |
| error text contains `Fatal error` | the message itself |
| help contains a hand-written heading | generated from declarations |
| `logger.info` output on stdout | stderr |

While you are there: add one asserting `manifest` parses and is deterministic.
It is the cheapest test in the suite and it covers your whole surface.

---

## The seven behaviour changes, in full

| # | Change | Who notices | Mechanical fix |
|---|---|---|---|
| 1 | `logger.info/success/warn/debug` → **stderr** | anything parsing your stdout for log lines | read stderr, or `--json` |
| 2 | undeclared option on a declared command → exit 2 | typos that used to pass silently | declare it (step 3) |
| 3 | unknown command → exit 2 (was 1) | scripts branching on `$? -eq 1` | branch on 2 |
| 4 | prompts fail fast when non-interactive | CI jobs that currently hang | this is the fix; add `createPrompter({ fallbackFlag: '--yes' })` |
| 5 | `version` prints `<name> <version>` | scripts parsing `v1.2.3` | usually a shorter parse |
| 6 | `json` / `ndjson` / `manifest` reserved | a command that already defines them | it keeps them; declare the option (step 4) |
| 7 | `cli.run()` exits on success too | code after `await cli.run()` | move it before, or `exitProcess: false` |

Everything else is additive. Every export published in 1.2.0 still resolves —
there is a conformance test that checks the 2.0 surface against the real
published one — and `ctx.args` is still a `string[]`.

## What you get to delete afterwards

Worth a look once the suite is green, because 2.0 makes these redundant:

- hand-written help screens and command indexes (generated)
- hand-maintained `validCommands` lists (routing)
- `process.exit(1)` scattered through commands (return `{ success: false }` or
  let `logger.error` do it)
- per-command `--json` plumbing, if you adopt the envelope
- any skill file or wiki page listing the commands (`manifest`)

## If something is genuinely broken

The contract is `CONTRACT.md` in this package, as numbered clauses. If your CLI
does something the contract says it should not, that is a framework defect and
worth reporting with the clause id — the conformance suite in
`tests/conformance/` runs against the packed tarball, so a reproduction there is
a fix.
