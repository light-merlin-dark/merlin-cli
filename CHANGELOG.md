# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
