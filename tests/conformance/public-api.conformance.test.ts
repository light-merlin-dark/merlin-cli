import { test, expect, describe, beforeAll } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureBuilt, runScript, DIST_ENTRY, REPO_ROOT } from './harness.ts';

/**
 * The public surface, locked against the built artifact.
 *
 * This list is not aspirational — it is what every consumer in the estate
 * actually imports, tallied across all 17 repos. Tree-shaking ate three of
 * these once while leaving their names in the export list, so "the name is
 * exported" is not the assertion. "It is callable and it works" is.
 */

/** Runtime values: must exist AND be usable, not merely defined. */
const RUNTIME_SYMBOLS = [
  'createCLI',
  'createCommand',
  'createToken',
  'LoggerToken',
  'PrompterToken'
] as const;

/**
 * Type-only exports: verified by compiling against the emitted .d.ts.
 *
 * Every one of these is named in the README. A consumer who follows the docs
 * and gets a tsc error is as broken as one whose import throws, so the docs and
 * the artifact are checked against each other here.
 */
const TYPE_SYMBOLS = [
  'Command',
  'CommandDefinition',
  'CommandContext',
  'OptionSpec',
  'ArgSpec',
  'CLIConfig',
  'Middleware',
  'Logger',
  'Prompter',
  'Token'
] as const;

/** Runtime exports the README tells people to use. */
const DOCUMENTED_RUNTIME = [
  ...RUNTIME_SYMBOLS,
  'ConfigToken',
  'createTestHarness',
  'createMockLogger',
  'createMockPrompter',
  'mockRegistry',
  'colors',
  'createProgress',
  'createLogger',
  'createPrompter',
  'CommandRouter',
  'ServiceRegistry',
  'resolveExitCode'
] as const;

describe('public API (built artifact)', () => {
  beforeAll(async () => {
    await ensureBuilt();
  }, 120_000);

  test('every runtime symbol the README documents is present in the bundle', async () => {
    const r = await runScript(
      `import * as m from __DIST__;\n` +
        `const missing = ${JSON.stringify(DOCUMENTED_RUNTIME)}.filter(k => m[k] === undefined);\n` +
        `console.log(JSON.stringify(missing));\n` +
        `process.exit(missing.length ? 1 : 0);\n`
    );

    expect(r.stdout.trim()).toBe('[]');
    expect(r.code).toBe(0);
  });

  test('the README quick-start runs exactly as printed', async () => {
    // Copied from the README, not paraphrased. Docs that drift from the
    // artifact are the same defect as an export list that drifts from it.
    const source =
      `import { createCLI, createCommand, LoggerToken } from __DIST__;\n` +
      `const greet = createCommand({\n` +
      `  name: 'greet',\n` +
      `  description: 'Greet someone by name',\n` +
      `  execute: (ctx) => {\n` +
      `    const logger = ctx.registry.get(LoggerToken);\n` +
      `    const name = ctx.args[0];\n` +
      `    if (!name) { logger.error('Who am I greeting?'); return; }\n` +
      `    logger.success(\`Hello, \${name}!\`);\n` +
      `  }\n` +
      `});\n` +
      `await createCLI({ name: 'mycli', version: '1.0.0', commands: { greet } }).run();\n`;

    const named = await runScript(source, ['greet', 'merlin']);
    expect(named.stdout).toContain('Hello, merlin!');
    expect(named.code).toBe(0);

    const missing = await runScript(source, ['greet']);
    expect(missing.stderr).toContain('Who am I greeting?');
    expect(missing.code).toBe(1);
  });

  test('the factory symbols are callable, not just defined', async () => {
    // The tree-shaken stub still *listed* these. Only calling them catches it.
    const r = await runScript(
      `import { createCLI, createCommand, createToken, LoggerToken, PrompterToken } from __DIST__;\n` +
        `const token = createToken('conformance.probe');\n` +
        `if (typeof token.key !== 'string') throw new Error('createToken returned no key');\n` +
        `if (typeof LoggerToken.key !== 'string') throw new Error('LoggerToken is not a token');\n` +
        `if (typeof PrompterToken.key !== 'string') throw new Error('PrompterToken is not a token');\n` +
        `const cmd = createCommand({ name: 'probe', description: 'd', execute: () => 'ran' });\n` +
        `if (cmd.name !== 'probe') throw new Error('createCommand did not build a command');\n` +
        `const cli = createCLI({ name: 'probe', version: '1.0.0', plugins: { enabled: false }, commands: { probe: cmd } });\n` +
        `if (typeof cli.run !== 'function') throw new Error('createCLI produced no run()');\n` +
        `if (typeof cli.registerCommand !== 'function') throw new Error('createCLI produced no registerCommand()');\n` +
        `console.log('all callable');\n`
    );

    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('all callable');
    expect(r.code).toBe(0);
  });

  test('a command built with createCommand routes and runs end to end', async () => {
    // createCommand is the single most-imported symbol (187 call sites).
    const r = await runScript(
      `import { createCLI, createCommand, LoggerToken } from __DIST__;\n` +
        `const greet = createCommand({\n` +
        `  name: 'greet', description: 'greets',\n` +
        `  execute: (ctx) => { ctx.registry.get(LoggerToken).info('hello ' + (ctx.args[0] ?? 'world')); }\n` +
        `});\n` +
        `const cli = createCLI({ name: 'probe', version: '1.0.0', plugins: { enabled: false }, commands: { greet } });\n` +
        `await cli.run();\n`,
      ['greet', 'merlin']
    );

    expect(r.stdout).toContain('hello merlin');
    expect(r.code).toBe(0);
  });

  test('the service registry resolves built-in tokens inside a command', async () => {
    const r = await runScript(
      `import { createCLI, LoggerToken, PrompterToken } from __DIST__;\n` +
        `const cli = createCLI({ name: 'probe', version: '1.0.0', plugins: { enabled: false }, commands: {\n` +
        `  probe: { name: 'probe', description: 'd', execute: (ctx) => {\n` +
        `    const logger = ctx.registry.get(LoggerToken);\n` +
        `    const prompter = ctx.registry.get(PrompterToken);\n` +
        `    if (typeof logger.info !== 'function') throw new Error('logger unusable');\n` +
        `    if (typeof prompter.confirm !== 'function') throw new Error('prompter unusable');\n` +
        `    console.log('registry ok');\n` +
        `  } }\n` +
        `} });\n` +
        `await cli.run();\n`,
      ['probe']
    );

    expect(r.stdout).toContain('registry ok');
    expect(r.code).toBe(0);
  });

  test('a consumer-registered custom token round-trips', async () => {
    const r = await runScript(
      `import { createCLI, createToken } from __DIST__;\n` +
        `const ApiToken = createToken('api');\n` +
        `const cli = createCLI({ name: 'probe', version: '1.0.0', plugins: { enabled: false }, commands: {\n` +
        `  probe: { name: 'probe', description: 'd', execute: (ctx) => { console.log(ctx.registry.get(ApiToken).ping()); } }\n` +
        `} });\n` +
        `cli.registry.register(ApiToken, { ping: () => 'pong' });\n` +
        `await cli.run();\n`,
      ['probe']
    );

    expect(r.stdout).toContain('pong');
    expect(r.code).toBe(0);
  });

  test('help and version resolve without a consumer defining them', async () => {
    const help = await runScript(
      `import { createCLI } from __DIST__;\n` +
        `await createCLI({ name: 'probe', version: '9.9.9', plugins: { enabled: false }, commands: {} }).run();\n`,
      ['help']
    );
    expect(help.code).toBe(0);

    const version = await runScript(
      `import { createCLI } from __DIST__;\n` +
        `await createCLI({ name: 'probe', version: '9.9.9', plugins: { enabled: false }, commands: {} }).run();\n`,
      ['version']
    );
    expect(version.stdout).toContain('9.9.9');
    expect(version.code).toBe(0);
  });

  test('the emitted .d.ts declares every type consumers import', async () => {
    // Types vanish at runtime, so the bundle test above cannot see them. A
    // consumer whose `tsc` breaks is just as broken as one whose import throws.
    const dir = mkdtempSync(join(tmpdir(), 'merlin-cli-types-'));
    const probe = join(dir, 'probe.ts');

    await Bun.write(
      probe,
      `import type { ${TYPE_SYMBOLS.join(', ')} } from ${JSON.stringify(DIST_ENTRY.replace(/\.js$/, ''))};\n` +
        `type Probe = [Command<unknown>, CommandDefinition, CommandContext, OptionSpec, ArgSpec,\n` +
        `  CLIConfig, Middleware, Logger, Prompter, Token<string>];\n` +
        `declare const _p: Probe;\nvoid _p;\n`
    );

    const proc = Bun.spawn(
      ['npx', 'tsc', '--noEmit', '--skipLibCheck', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2022', probe],
      { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' }
    );

    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);

    expect(stdout).toBe('');
    expect(code).toBe(0);
  }, 120_000);
});
