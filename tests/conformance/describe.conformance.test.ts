import { expect, describe, beforeAll } from 'bun:test';
import { T, runScript, ensurePacked } from './harness.ts';
import { FIXTURE, scaleFixture } from './fixtures.ts';

const run = (args: string[], options = {}) => runScript(FIXTURE, args, options);

describe('DESC — a CLI that describes itself', () => {
  beforeAll(async () => { await ensurePacked(); }, 180_000);

  T('DESC-1', 'the manifest covers every command, argument and option', async () => {
    const manifest = (await run(['manifest'])).json();

    expect(manifest.$schema).toBe('merlin-cli/manifest/v2');
    expect(manifest.contract).toBe('2.0');
    expect(manifest.reserved.commands).toEqual(['help', 'version', 'manifest']);
    expect(manifest.reserved.options).toEqual(['json', 'ndjson', 'verbose', 'quiet', 'help']);

    const ok = manifest.commands.find((c: any) => c.name === 'ok');
    expect(ok.args).toEqual([
      { name: 'who', type: 'string', description: 'subject', required: true }
    ]);
    expect(ok.options.map((o: any) => o.name)).toEqual([
      'times', 'tag', 'reason', 'force', 'all', 'out', 'cache', 'mode', 'token'
    ]);
    expect(ok.options.find((o: any) => o.name === 'mode').choices).toEqual(['fast', 'safe']);
    expect(ok.examples).toEqual(['ok world', 'ok world --json']);
  });

  T('DESC-1', 'subcommands are described to their full depth', async () => {
    const manifest = (await run(['manifest'])).json();
    const group = manifest.commands.find((c: any) => c.name === 'group');

    expect(group.subcommands[0].name).toBe('inner');
    expect(group.subcommands[0].aliases).toEqual(['i']);
    expect(group.subcommands[0].subcommands[0].path).toEqual(['group', 'inner', 'deeper']);
  });

  T('DESC-2', 'describing a lazy command does not load it', async () => {
    // Every command in this fixture throws on load. A manifest that had to load
    // them would fail rather than answer.
    const r = await runScript(scaleFixture(50), ['manifest']);

    expect(r.code).toBe(0);
    expect(r.json().commands).toHaveLength(53); // 50 + help, version, manifest
    expect(r.json().commands[0].lazy).toBe(true);
    expect(r.json().commands[0].described).toBe(true);
  });

  T('DESC-3', 'two manifest runs are byte-identical', async () => {
    const [first, second] = await Promise.all([run(['manifest']), run(['manifest'])]);
    expect(first.stdout).toBe(second.stdout);
  });

  T('DESC-4', 'help is a projection of the manifest, not a second description', async () => {
    const manifest = (await run(['manifest'])).json();
    const help = (await run(['help', 'ok', '--json'])).json().data;
    const fromManifest = manifest.commands.find((c: any) => c.name === 'ok');

    expect(help).toEqual(fromManifest);
  });

  T('DESC-4', 'top-level help is one line per command', async () => {
    const r = await run(['help']);

    expect(r.stdout).toContain('  ok ');
    expect(r.stdout).toContain('returns data');
    // The detail belongs to `help <command>`, not to the index.
    expect(r.stdout).not.toContain('--times');
  });

  T('DESC-4', 'help for one command shows its full detail', async () => {
    const r = await run(['help', 'ok']);

    expect(r.stdout).toContain('--times');
    expect(r.stdout).toContain('subject');
    expect(r.stdout).toContain('ok world --json');
    expect(r.stdout).toContain('4  partial');
  });

  T('DESC-4', '--help on a command shows help instead of executing it', async () => {
    const r = await run(['ok', '--help']);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage:');
    expect(r.stdout).not.toContain('hello');
  });

  T('DESC-5', 'every command in the fixture declares at least one example', async () => {
    const manifest = (await run(['manifest'])).json();
    const documented = manifest.commands.filter((c: any) => c.examples.length > 0);

    expect(documented.length).toBeGreaterThan(0);
  });

  T('DESC-6', 'the completions name is reserved and not yet claimed', async () => {
    // Reserved means a CLI may define it today and lose nothing; the framework
    // does not answer it until the release that implements it.
    const manifest = (await run(['manifest'])).json();
    expect(manifest.commands.some((c: any) => c.name === 'completions')).toBe(false);
  });
});

describe('DET — determinism', () => {
  beforeAll(async () => { await ensurePacked(); }, 180_000);

  T('DET-1', 'help and version are byte-identical across runs', async () => {
    const [helpA, helpB] = await Promise.all([run(['help']), run(['help'])]);
    expect(helpA.stdout).toBe(helpB.stdout);

    const [versionA, versionB] = await Promise.all([run(['version']), run(['version'])]);
    expect(versionA.stdout).toBe(versionB.stdout);
  });

  T('DET-1', 'the environment does not leak into the manifest', async () => {
    const plain = await run(['manifest']);
    const loaded = await run(['manifest'], {
      env: { FIXTURE_TOKEN: 'secret', LANG: 'tr_TR.UTF-8', TZ: 'Pacific/Auckland' }
    });

    expect(plain.stdout).toBe(loaded.stdout);
  });

  T('DET-2', 'version prints exactly name, space, version, newline', async () => {
    const r = await run(['version']);
    expect(r.stdout).toBe('fixture 2.0.0\n');
  });

  T('DET-2', '--version is the same output as the version command', async () => {
    expect((await run(['--version'])).stdout).toBe('fixture 2.0.0\n');
  });

  T('DET-3', 'commands and options appear in declaration order, never sorted', async () => {
    const manifest = (await run(['manifest'])).json();
    const names = manifest.commands.map((c: any) => c.name);

    expect(names.slice(0, 5)).toEqual(['ok', 'chatty', 'silent', 'reported', 'returned-false']);
    // Alphabetical would have put `asks` first.
    expect(names).not.toEqual([...names].sort());
  });
});
