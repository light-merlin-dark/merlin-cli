# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
