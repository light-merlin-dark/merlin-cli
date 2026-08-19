# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.3]

### Changed — MIGRATING.md, after seven real migrations

Two steps added, both from things that actually went wrong:

- **Let `manifest` past whatever guards your bootstrap.** `cli.bootstrap` runs
  before the router decides what was asked for, so anything it demands is
  demanded of every command. Three CLIs answered `manifest` with a credential
  error — an agent could not learn what the tool does without being handed a
  secret first.
- **Use the package manager whose lockfile is tracked.** Running `npm install`
  in a Bun project rewrote one repo's `node_modules` in a way its native
  dependency could not survive, which looked exactly like a migration failure
  and was not one.

## [2.0.2]

### Added — MIGRATING.md, shipped with the package

An eight-step migration procedure, written while migrating real CLIs and naming
the specific things that went wrong in them: pre-router command gates that
reject `manifest`, options read but never declared, `--json` that a command
already owns, and `onError` hooks that flatten exit 2 into exit 1.

It ships in the tarball rather than only living in this repository, because the
migration happens in the consumer's tree — where the guide is now readable at
`node_modules/@light-merlin-dark/merlin-cli/MIGRATING.md`.

## [2.0.1]

### Fixed — colour functions rejected numbers

`picocolors` typed its formatters to accept anything printable, and
`colors.cyan(port)` on a number is a real call site. Replacing it with
first-party code narrowed the signature to `string`, which broke the *types* of
consumer code that had not changed a line. The signature is now
`string | number | boolean | null | undefined`, as it was, and a type probe in
the conformance suite compiles those three call shapes against the emitted
`.d.ts` so it cannot narrow again.

Also carries a usage error's exit code through an `onError` hook: a hook that
enriches the message no longer flattens 2 into 1.

## [2.0.0]

Commands are read by machines more often than by people now. 1.x already
guaranteed that an exit code told the truth; 2.0 makes the same guarantee for
everything else a caller observes — which stream carried what, whether the
output parses, and whether the tool can say what it does without being asked
one command at a time.

The mechanism is a single change of shape: a command computes a result and
returns it, and every observable is a projection of that one result. The exit
code, the human text, the JSON envelope, the NDJSON stream. They cannot
disagree, because there is only one source.

Everything is written down in [CONTRACT.md](CONTRACT.md) as numbered clauses,
and every clause that says MUST has a test that runs against the packed tarball
in a real subprocess. The suite parses the contract and fails the build if a
clause has no test.

### Added — `--json` and `--ndjson`, on every command, for free

```
$ mycli deploy staging --json
{"ok":true,"code":0,"command":"deploy","data":{"url":"…"},"error":null,
 "cli":{"name":"mycli","version":"1.0.0","contract":"2.0"}}
```

1.x commands already returned values; the framework used them only to derive an
exit code and then threw them away. Now the same value is the machine payload,
so **most existing commands gain `--json` with no code change at all.**

`ctx.emit(item)` streams one NDJSON line per item, envelope last, in constant
memory.

In machine mode the framework also relays anything written directly to stdout
onto stderr as `{"ev":"out","text":"…"}`. Consumers print with `console.log`
everywhere and cannot all be rewritten; making the framework own the channel is
what lets `--json` work on day one for CLIs written years before this.

A command that declares its own `json` or `ndjson` option keeps its own meaning
and the framework defers.

### Added — `manifest`, a CLI that describes itself

One deterministic call returns the whole surface: every command and subcommand,
arguments, options, environment fallbacks, choices, examples, documented exit
codes. No command implementation is loaded to produce it, so it costs the same
on a five-hundred-command CLI as on a five-command one. `help` is a projection
of the same data, so the two cannot drift.

`lazy({ name, description, load })` declares a command whose metadata is known
immediately and whose module loads on first use. 1.x lazy commands were opaque
thunks: help could not describe them and aliases could not find them without
loading every module, so it did not try.

### Added — cancellation, and prompts that cannot hang

Every command receives `ctx.signal`. SIGINT and SIGTERM abort it, allow a grace
period (`gracePeriodMs`, 3 s by default) and then leave with 130 or 143. A
cleanup handler that swallows the abort and returns normally no longer reports
success.

A prompt with no terminal now fails immediately with exit 2 instead of blocking
forever, naming the question and — when the prompter declares a `fallbackFlag`
— the flag that would have answered it.

### Added — a written grammar

`--`, `--name=value`, `--no-name`, `-abc` bundling, `-ovalue`, negative numbers
as positionals, arrays that accumulate, `choices`, `env:` fallbacks, and a fixed
validation order. 1.x parsed flags with a loop that guessed.

### Changed — stdout is payload, stderr is commentary

Every logger level now writes to stderr, including `info` and `success`, which
1.x sent to stdout and which therefore ended up inside anything that piped a
CLI. `mycli export | jq .` works.

### Changed — usage errors exit 2

Unknown command, unknown subcommand, an undeclared option on a command that
declares a surface, a bad value, a missing required argument, a prompt with no
terminal. "You called me wrong" and "I tried and failed" need different fixes.

Strictness is earned by declaring: a command that passed neither `args` nor
`options` keeps 1.x's permissive parsing exactly.

### Changed — zero runtime dependencies

`picocolors` and `prompts` are gone, replaced by about sixty and one hundred and
twenty lines of first-party code. Colour now follows a rule the contract can
test: ANSI bytes never reach a pipe.

### Changed — smaller things worth knowing

- `version` prints `<name> <version>`, not `v<version>`.
- `--help`, `-h` and `--version` work at the top level; 1.x reported them as
  unknown commands.
- `cli.run()` exits the process on success too, so a stray `setInterval` cannot
  keep a finished CLI alive. Set `exitProcess: false` to keep the old behaviour.
- Help and the manifest list commands in declaration order, not alphabetically.
- `createCommand` now passes `subcommands` through. It silently dropped them
  before, which meant subcommands declared that way never worked.
- Signal handling moved out of `bootstrap`, where SIGINT exited **0**.

### Fixed — `table()` and `box()` joined lines with a literal backslash-n

Both used `'\\n'` where `'\n'` was meant, so every row of a table came back on
one line.

### Compatibility

Every export published in 1.2.0 still resolves; a conformance test checks the
2.0 surface against the real published one rather than a hand-kept list.
`ctx.args` is still a `string[]` — typed positionals arrive on `ctx.namedArgs`
— because redefining it would have broken every command in every consumer.

The seven behavioural changes above are enumerated with mechanical fixes in the
README's upgrade table, and every consumer in the estate was audited against
them before this was published.

## [1.2.0]

Open source, and a third of the code gone. Published as
`@light-merlin-dark/merlin-cli` on npmjs.org, continuing the public 1.0.8
lineage; the private `@merlin/cli` name is retired.

### Fixed — `logger.error(...)` followed by a bare `return` exited 0

1.1.0 made a returned `{ success: false }` exit non-zero, but it reads the
command's *return value*, so it was blind to the other way a command reports
failure:

```ts
logger.error('Zone not found');
return;                            // red text, exit code 0
```

cf-cli alone had sixteen of these. Auditing every consumer forever is not a
fix, so the framework catches it: the logger counts the errors it reported, and
a command that logged one has failed regardless of what it returned. Opt out
with `errorExitPolicy: 'off'`.

The count hangs off a `Symbol` rather than a named method, because `Logger` is a
public interface consumers implement themselves — a required member would break
every one of those.

**This works for your logger too.** Consumers usually register their own logger
under `LoggerToken`, typically from `cli.bootstrap`, which replaces the
framework's. Counting only our own logger would have made this feature a silent
no-op for most real CLIs — so registration is intercepted, and any logger
landing under `LoggerToken` is wrapped with counting. The wrapper is a `Proxy`:
your methods, properties and `this` binding are untouched.

**Known limits.** The rule hooks *registration*, so two things stay invisible to
it: `console.error(...)`, and a logger your modules import directly instead of
resolving from the registry — never registered, never counted. Commands that
report failure either way still exit 0. Resolve the logger from `ctx.registry`
(or register your own under `LoggerToken`) to get the guarantee.

### Changed — `validateOptions` and `logExecution` are no longer top-level exports

`validateOptions` previously resolved to the *validation utility* of that name,
not the middleware, because two modules exported the symbol and `export *` made
the winner arbitrary. Both are still available at
`@light-merlin-dark/merlin-cli/dist/commands/index.js`. No consumer imported
either.

### Fixed — `require()` of this package threw

`exports` promised a CommonJS build at `./dist/index.cjs` that the build script
never produced. The map now describes what is actually in the tarball, and a
conformance test walks it.

### Removed

- **`SmartRelease`** — release orchestration in a CLI framework. Consumers
  vendor their own; `m-cli` already did.
- **The plugin system** (313 lines) — no consumer ever loaded a plugin. The
  `plugins` config key is still accepted and ignored so existing
  `plugins: { enabled: false }` keeps compiling.
- **`utils/errors.ts`, `utils/formatting.ts`, `utils/validation.ts`** (706
  lines, ~60 exported symbols) — not one imported by any consumer.
  `validation.ts` also exported a second `validateOptions` that collided with
  the middleware of the same name; `export *` made the winner arbitrary.
- **`valibot`** — a declared dependency with zero imports, which the README
  advertised. Every consumer was installing it for nothing.

`@types/node` moved from `dependencies` to `devDependencies`.

### Added — `tests/conformance/`

Runs against the built artifact in a real child process: packs the tarball,
unpacks it, imports it under plain Node, and asserts on the process exit status
a shell would see. `prepublishOnly` runs it, so the artifact is proven before
publish rather than after it breaks someone.

Four defects in two days were all the same species — no test asserted the
contract. A fifth turned up while writing these: `tests/unit/subcommands.test.ts`
asserted that `run()` *throws* on an unknown subcommand. It doesn't; it exits.
So the file killed the test runner partway through, silently took every later
test file with it, and the suite still reported success. Its six tests now run.

## [1.1.0]

Minor, not patch: exit codes change for any command that reported failure by
returning a result. Not major: the one breaking API change since 1.0.6 (the
Valibot validation swap) is in surface no consumer imports — every consumer in
the estate imports exactly five symbols, `createCLI`, `ServiceRegistry`,
`createToken`, `LoggerToken`, `PrompterToken`.

### Fixed — the build silently shipped a dead bundle

`"sideEffects": false` made `bun build` (1.3.14) tree-shake `core/cli.ts`,
`commands/router.ts`, `core/exit-code.ts` and most of the framework out of the
bundle while leaving their names in the export list. `bun build` reported
success with no warning: "Bundled 18 modules" of 33, 65 KB, exit 0. The
resulting `dist/index.js` could not be imported at all — Node rejects it with
`SyntaxError: Export 'CommandRouter' is not defined in module`, and `createCLI`
was likewise absent.

Publishing that artifact would have taken cf-cli and db-cli down completely.
Pre-existing: the same breakage reproduces on 05b77d9 and on every
`--target`/`--outfile` combination. The published 1.0.6 `dist` is intact
because it was built under an older bun.

- Removed `sideEffects: false`. The bundle goes from 18 to 102 modules and
  imports cleanly with 124 exports.
- Known, not fixed: `exports.require` points at `./dist/index.cjs`, which the
  build has never produced. Every consumer is ESM, so nothing is broken today.

### Changed — back to a single private name

The package was renamed to `@light-merlin-dark/merlin-cli` and published to
public npm on 2025-11-13 (1.0.7 and 1.0.8, sixty-six seconds apart) and never
touched again. It gathered 1 star, 0 forks and ~6 downloads/month, while the
whole estate kept consuming `@merlin/cli@1.0.6` from `npm.private.invalid`. The split
meant a fix in this repo could not reach a single consumer.

- Name is `@merlin/cli` again; `publishConfig` points at `https://npm.private.invalid/`
  with restricted access. Consumers on `latest` need no change.
- `publish:public` script replaced by `publish:private`.
- The public `@light-merlin-dark/merlin-cli` versions are superseded.

### Fixed — exit-code fail-open (behavior change)

`createCLI(...).run()` discarded whatever the command returned and exited 0
unconditionally. Any command signalling failure by returning a result — the
widespread `return { success: false, error }` convention — printed its error and
told every shell, CI gate and agent checking `$?` that it had succeeded.
Throwing was the only failure channel the framework offered.

Measured instance: `cf zone create <domain>` hit a Cloudflare permission denial,
printed `❌ Requires permission com.cloudflare.api.account.zone.create`, and
exited 0.

- `CommandRouter.route()` and `executeCommand()` now return the command's value
  instead of `Promise<void>`. The value is captured in a closure around the
  middleware chain, so the public `Middleware` signature is unchanged.
- `run()` maps that value onto an exit code via the new `resolveExitCode()`:
  `{ success: false }` → 1, `{ exitCode: n }` → n (clamped to 0-255 so a code
  like 256 cannot silently wrap back to 0), and everything else — `undefined`,
  primitives, arrays, data objects, `{ success: true }` — → 0. Commands
  returning void or data are unaffected.
- `run()` now resolves with the exit code (`Promise<number>`, was
  `Promise<void>`). New `exitProcess` config option (default `true`) suppresses
  the `process.exit()` call for tests and embedders.
- An `onError` hook that handles an error without exiting no longer causes a
  zero exit; the router reports a failure result to the caller.
- `defaultHandler` results are honoured the same way.

**This flips exit codes for downstream CLIs.** Gates that previously passed
against a failing command will start failing — correctly. Audit consumers for
`return { success: false }` before publishing.

### Added
- `resolveExitCode()`, `isFailureResult()`, `GENERIC_FAILURE_EXIT_CODE` and the
  `CommandResult` type are exported for consumers that want the same mapping.
- **Valibot Integration**: Replaced custom validation with Valibot for better type safety and validation
- **Improved Async Handling**: Fixed async messaging issue by properly handling event loop completion
- **Double-Bootstrap Prevention**: Added safeguard against multiple bootstrap calls
- **Enhanced Error Types**: Improved TypeScript error type annotations throughout codebase
- **Comprehensive Documentation**: Complete rewrite of README with VSSH-style documentation
- **Better Signal Handling**: Improved graceful shutdown with proper I/O completion

### Changed
- **Breaking**: Updated validation API to use Valibot schemas (legacy API maintained for compatibility)
- **Package Name**: Renamed to `@light-merlin-dark/merlin-cli` for public NPM release
- **TypeScript Config**: Updated tsconfig.json with proper Node.js and Bun types
- **Bootstrap Process**: Enhanced with proper error typing and I/O completion handling
- **CLI Exit Behavior**: Removed premature `process.exit(0)` calls to allow async operations to complete

### Fixed
- **Async Messaging Bug**: Fixed issue where console output was cut off due to premature process exit
- **TypeScript Errors**: Resolved all type definition issues with Node.js globals
- **Signal Handlers**: Fixed graceful shutdown to properly flush I/O before exit
- **Error Handling**: Improved error propagation and logging in bootstrap process

## [1.0.6] - Previous Release

### Features
- Core CLI framework with command routing
- Service registry with dependency injection
- Plugin system with auto-loading
- Built-in logger and prompter services
- Middleware support
- Custom routing capabilities
- Subcommand support
- Lazy command loading
- Smart release automation
- Comprehensive testing utilities
- Progress indicators and spinners
- Help and version commands
- Example implementations

### Known Issues (Fixed in Unreleased)
- Async operations could be cut off due to premature process exit
- Custom validation system without schema composition

---

## Version History

- **v1.0.6**: Initial release with core features
- **v1.0.7** (upcoming): Valibot integration, async fixes, public release preparation
