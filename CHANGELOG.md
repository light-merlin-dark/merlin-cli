# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed — exit-code fail-open (behavior change, announce before publishing)

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
