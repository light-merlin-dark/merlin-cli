# The merlin-cli contract, version 2.0

This document states what every CLI built with this framework guarantees to
every caller: a person at a terminal, a shell script, a CI job, an agent.

It is normative. Keywords MUST, MUST NOT, SHOULD and MAY are used as in
RFC 2119. Every clause has an identifier such as `TRUTH-1`, and **every MUST
clause maps to at least one test in `tests/conformance/`**, which runs against
the packed tarball in a real subprocess. The suite parses this file and fails
the build if a clause here has no test — a clause without a test is a comment,
not a contract.

Clauses marked **(process)** govern how this repository is maintained rather
than how a CLI behaves at runtime, and are reviewed rather than executed.

## Definitions

- **CLI** — a program built with `createCLI` and run via `.run()`.
- **payload** — the data a command produces for its caller.
- **commentary** — everything else it says while working: logs, warnings,
  progress, prompts.
- **text mode** — the default rendering, for people.
- **machine mode** — the rendering selected by `--json` or `--ndjson`.
- **declared command** — one that passed `args` or `options` to
  `createCommand`. Commands that declare neither keep the permissive 1.x
  parsing and forfeit the clauses marked ⊳.

---

## 1. Truth — the exit code (TRUTH)

**TRUTH-1.** The process exit code MUST be derived from the command's outcome
by this table, in this precedence order:

| Outcome | Exit code |
|---|---|
| throws | `1`, or the thrown error's declared `exitCode`, clamped |
| returns `{ exitCode: n }` | `n` clamped to 0–255 |
| returns `{ success: false }` | `1` |
| reported an error on the registered logger while running | `1`, even if the return value implies `0` |
| returns anything else — `undefined`, data, `{ success: true }` | `0` |

**TRUTH-2.** Out-of-range or non-finite codes MUST collapse to `1`. They MUST
NOT wrap and MUST NOT pass through: `process.exit(256)` reports `0` to the
shell, which would turn a failure into a success at the last possible moment.

**TRUTH-3.** The logger rule (`errorExitPolicy: 'strict'`, the default) MUST
apply to whatever logger is registered under `LoggerToken`, by whoever
registers it and whenever — including registrations made after `createCLI`
returns. Consumer loggers are wrapped transparently: their methods, properties
and `this` binding are untouched. Opting out is per CLI (`'off'`), never per
command.

**TRUTH-4.** In machine mode the envelope's `ok` MUST equal `code === 0`, and
`code` MUST equal the process's actual exit status.

**TRUTH-5.** An error consumed by an `onError` hook is still a failure. Hooks
MAY enrich reporting; they MUST NOT convert failure into success.

## 2. Streams — payload and commentary (STREAM)

**STREAM-1.** stdout MUST carry only payload: rendered results in text mode,
the envelope in `--json`, the item stream in `--ndjson`, and the output of
`help`, `version` and `manifest`, whose output is their payload.

**STREAM-2.** The framework's logger MUST write every level to stderr —
`info`, `success`, `warn`, `debug` and `error`. In 1.x, four of the five went
to stdout, which put log lines inside anything that piped a CLI.

**STREAM-3.** A command that produces no payload MUST write nothing to stdout.
`$(mycli deploy)` capturing an empty string is correct.

**STREAM-4.** Prompts MUST be written to stderr and read from stdin's terminal,
so that redirecting stdout never captures a question and piping stdin never
answers one.

## 3. Machine mode (MODE)

**MODE-1.** Every CLI MUST accept `--json` on any command. stdout then carries
exactly one JSON document, newline-terminated:

```json
{
  "ok": true,
  "code": 0,
  "command": "dns add",
  "data": { "record": "A", "name": "api", "ttl": 300 },
  "error": null,
  "cli": { "name": "mycli", "version": "3.1.0", "contract": "2.0" }
}
```

`data` is the command's return value minus the keys it may have used to signal
outcome (`success`, `exitCode`, `error`). `error.message` MUST be present on
failure; `error.stack` MUST NOT appear unless `--verbose`. `data` is the only
application-shaped field: the envelope has no second extension point.

**MODE-2.** In machine mode, commentary MUST be rendered as NDJSON on stderr,
one event per line — `{"ev":"log","level":"warn","msg":"…"}` — so both channels
can be stream-parsed without heuristics. Bytes a command writes to stdout
directly are relayed as `{"ev":"out","text":"…"}` rather than being allowed to
corrupt the document.

**MODE-3.** Every CLI MUST accept `--ndjson`. Each `ctx.emit(item)` writes one
JSON line to stdout as it happens, and the envelope is the final line.

**MODE-4.** Machine mode MUST be explicit. The framework MUST NOT change output
shape because stdout is not a TTY. A piped text mode is still text mode.

**MODE-5.** If a command declares an option named `json` or `ndjson`, the
command's meaning MUST win for that invocation and the framework mode MUST be
disabled there. The manifest records the shadowing.

**MODE-6.** `help`, `version` and `manifest` MUST honour `--json`.

## 4. Self-description (DESC)

**DESC-1.** Every CLI MUST answer the reserved command `manifest` with a JSON
document describing its whole surface: every command and subcommand, with
description, aliases, args, options, examples, declared exit codes and any
shadowed reserved names. Schema id `merlin-cli/manifest/v2`.

**DESC-2.** The manifest MUST be complete without executing or importing any
command implementation. Lazily loaded commands carry their metadata inline.

**DESC-3.** The manifest MUST be deterministic: declaration order, stable key
order, no environment leakage, byte-identical across runs.

**DESC-4.** `help` output MUST be a projection of the same data the manifest
exposes, so the two cannot drift.

**DESC-5.** Every command SHOULD declare at least one example.

**DESC-6.** The command name `completions` is reserved for a future release.

## 5. Grammar (GRAM)

**GRAM-1.** Tokens MUST be classified left to right by this table:

| Token | Meaning |
|---|---|
| `--` | ends option parsing; the rest is positional, verbatim |
| `--name=value`, `--name value` | sets a declared option |
| `--name` | sets a declared boolean true |
| `--no-name` | sets a declared boolean false |
| `-abc` | bundles declared boolean shorts `a`, `b`, `c` |
| `-o value`, `-ovalue` | binds a declared value-taking short |
| `-2`, `-0.5` | positional, when no such short option is declared |

**GRAM-2.** Options and positionals MAY interleave. Order among positionals
MUST be preserved, and options MUST be position-independent.

**GRAM-3.** Values are coerced to the declared type. `number` MUST reject
non-numeric input as a usage error rather than producing `NaN`. `array`
accumulates across repeats. Repeating a non-array option is last-wins plus a
warning.

**GRAM-4 ⊳.** For a declared command, an undeclared option MUST be a usage
error. Undeclared commands keep permissive passthrough.

**GRAM-5.** Validation order is fixed and total: route → parse → coerce →
defaults → required → choices → custom validators → `execute`. A command's
`execute` MUST NOT run if any earlier stage fails, and the message MUST name
the offending token and the expected form.

**GRAM-6.** Subcommands nest to arbitrary depth; resolution consumes the
longest declared path. Aliases MUST resolve without loading a lazy command's
module.

## 6. Exit codes (EXIT)

**EXIT-1.** The framework reserves these codes and MUST emit them as follows:

| Code | Meaning | Emitted when |
|---|---|---|
| `0` | success | TRUTH-1 |
| `1` | runtime failure | TRUTH-1, and unhandleable internal errors |
| `2` | usage error | unknown command or subcommand, GRAM-4/5 failures, a prompt with no terminal |
| `130` | interrupted | SIGINT (CANCEL-2) |
| `143` | terminated | SIGTERM (CANCEL-2) |

**EXIT-2.** Usage errors MUST be distinguishable from runtime failures. "You
called me wrong" and "I tried and failed" need different remediation, and a
caller should not have to parse prose to tell them apart.

**EXIT-3.** Codes 3–125 belong to the application, via `{ exitCode: n }` and
optionally documented per command with `exitCodes`, which puts them in the
manifest. The framework MUST NOT emit 126, 127 or 255.

## 7. Environment (ENV)

**ENV-1.** Colour is emitted only when the target stream is a TTY, `NO_COLOR`
is unset and `TERM` is not `dumb`. `FORCE_COLOR` overrides TTY detection. ANSI
bytes MUST NOT reach a pipe unless forced.

**ENV-2.** Progress indicators MUST render only on a TTY stderr.

**ENV-3.** Adaptation is presentation-only. TTY-ness MUST NOT change what a
command does, which stream carries what, or the shape of machine output.

**ENV-4.** The framework reads exactly `NO_COLOR`, `FORCE_COLOR`, `TERM`, `CI`,
and any `env:` fallbacks an application declares on its own options. It MUST
NOT invent private environment switches.

## 8. Prompts never hang (HANG)

**HANG-1.** A prompt attempted when stdin is not a terminal MUST fail
immediately with exit `2`. It MUST NOT block. The message MUST name the
question, and MUST name the fallback flag when the prompt declares one.

**HANG-2.** Machine mode implies non-interactive: prompts MUST fail per HANG-1
even on a TTY.

**HANG-3.** Once the exit code is known the framework flushes pending writes
and leaves. Application code that left a timer running MUST NOT keep a finished
CLI alive when `exitProcess` is on, which is the default.

## 9. Cancellation (CANCEL)

**CANCEL-1.** Every command MUST receive `ctx.signal`, an `AbortSignal`, which
the framework aborts on SIGINT or SIGTERM.

**CANCEL-2.** After a grace period (default 3000 ms, configurable), or on a
second signal, the process exits with `130` for SIGINT or `143` for SIGTERM. A
cleanup handler MUST NOT be able to turn an interrupt into exit `0`.

**CANCEL-3.** In machine mode, an interrupted run MUST still emit its final
envelope, carrying the interrupt's code.

## 10. Determinism (DET)

**DET-1.** `help`, `version` and `manifest` output MUST be a pure function of
the CLI definition: byte-identical across runs, with no timestamps, no locale
formatting, no hash-order iteration and no network.

**DET-2.** `version` MUST print exactly `<name> <version>` and a newline in
text mode, and nothing else. It is parsed by more scripts than any other output
a CLI produces.

**DET-3.** Command and option ordering, in help and in the manifest, MUST be
declaration order.

## 11. Performance (PERF)

Budgets are expressed as ratios rather than milliseconds so they stay testable
on any machine.

**PERF-1.** Startup MUST be O(1) in command count: cold `version` of a CLI with
500 described-lazy commands completes within 1.5× the wall time of one with 5.

**PERF-2.** Framework overhead — import, `createCLI`, route, resolve — MUST
stay under 4× the runtime's bare `process.exit(0)` script time.

**PERF-3.** `--ndjson` streaming MUST be constant-memory in item count. Items
flow through; they are never accumulated for the envelope.

**PERF-4.** The published `dist/index.js` MUST stay under 150 KB unminified.

## 12. Compatibility (COMPAT)

**COMPAT-1 (process).** *Never break a consumer* outranks every other
engineering value in this repository, including line-count targets, aesthetics
and this document's own completeness.

**COMPAT-2 (process).** Within a major version, exports are never removed,
clause semantics never change, and the conformance suite never shrinks.

**COMPAT-3 (process).** A major version requires an enumerated table of every
breaking change, a mechanical fix for each, and a migration audit of every
known consumer before publish.

**COMPAT-4.** A conforming CLI MUST state `contract: "2.0"` in every envelope
and manifest, which is a claim about which clause set it passes.

---

## Constitutional exclusions

These are permanently out of scope. Adding any of them requires a new major of
this document and a written case.

| Excluded | Reason |
|---|---|
| TUI / full-screen interactive UI | Breaks every non-human caller; another tool's job |
| Network access of any kind | A framework that can phone home can be made to |
| Telemetry | Not opt-in, not anonymised, not version counts |
| Auto-update or self-modification | Supply-chain surface; breaks determinism |
| Config-file discovery | Implicit global state; the application may do this, the framework must not |
| Plugin loading from disk paths or packages | Arbitrary code execution surface |
| Locale-sensitive output | The same input must produce the same bytes everywhere |
| Install scripts | The package is inert until imported |
| Runtime dependencies | Zero, permanently |

## Where 2.0 deliberately differs from its draft

Recorded because each was a decision, not an oversight.

- `ctx.args` remains `string[]`. Typed positionals arrive by name on
  `ctx.namedArgs`. Redefining `ctx.args` as a record would have broken every
  command in every consumer, and COMPAT-1 outranks the ergonomics.
- Reserved flags are not stripped from `ctx.options`. A 1.x command that reads
  `options.json` itself keeps seeing it.
- A parent command that groups subcommands and has no `execute` prints its help
  and exits `0`, as in 1.x, rather than treating a missing verb as a usage
  error.
- `ctx.emit` under `--json` collects items into the document, because the
  caller asked for one document. PERF-3 constrains `--ndjson`, where streaming
  is the point.
