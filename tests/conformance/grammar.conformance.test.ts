import { expect, describe, beforeAll } from 'bun:test';
import { T, runScript, ensurePacked } from './harness.ts';
import { FIXTURE } from './fixtures.ts';

const run = (args: string[], options = {}) => runScript(FIXTURE, args, options);

/** Run `ok` and return the context it saw. */
async function parsed(args: string[]) {
  const r = await run(['ok', ...args, '--json']);
  if (r.code !== 0) throw new Error(`exit ${r.code}: ${r.stderr}`);
  return r.json().data;
}

describe('GRAM — one parser, written down', () => {
  beforeAll(async () => { await ensurePacked(); }, 180_000);

  T('GRAM-1', '-- ends option parsing and the rest is verbatim', async () => {
    const r = await run(['ok', 'world', '--json', '--', '--not-an-option', '-x']);
    const data = r.json().data;

    expect(data.argv).toEqual(['--not-an-option', '-x']);
    expect(data.args).toEqual(['world', '--not-an-option', '-x']);
  });

  T('GRAM-1', 'a reserved flag after -- is data, not a mode', async () => {
    // `--json` past the separator must not turn the run into an envelope.
    const r = await run(['ok', 'world', '--', '--json']);

    expect(r.code).toBe(0);
    expect(r.stdout).toBe('hello world\n');
  });

  T('GRAM-1', '--name=value and --name value are the same', async () => {
    expect((await parsed(['world', '--out=here'])).options.out).toBe('here');
    expect((await parsed(['world', '--out', 'here'])).options.out).toBe('here');
  });

  T('GRAM-1', '--name sets a declared boolean and --no-name clears it', async () => {
    expect((await parsed(['world', '--force'])).options.force).toBe(true);
    expect((await parsed(['world'])).options.cache).toBe(true);
    expect((await parsed(['world', '--no-cache'])).options.cache).toBe(false);
  });

  T('GRAM-1', '-abc bundles declared boolean shorts', async () => {
    const data = await parsed(['world', '-fa']);
    expect(data.options.force).toBe(true);
    expect(data.options.all).toBe(true);
  });

  T('GRAM-1', '-o value and -ovalue both bind', async () => {
    expect((await parsed(['world', '-o', 'here'])).options.out).toBe('here');
    expect((await parsed(['world', '-ohere'])).options.out).toBe('here');
  });

  T('GRAM-1', 'a negative number is a positional, not an unknown short option', async () => {
    const data = await parsed(['world', '--times', '-2']);
    expect(data.options.times).toBe(-2);
  });

  T('GRAM-2', 'options and positionals may interleave', async () => {
    const before = await parsed(['--force', 'world']);
    const after = await parsed(['world', '--force']);

    expect(before.who).toBe('world');
    expect(after.who).toBe('world');
    expect(before.options.force).toBe(after.options.force);
  });

  T('GRAM-2', 'order among positionals is preserved', async () => {
    const data = await parsed(['first', '--force', 'second', 'third']);
    expect(data.args).toEqual(['first', 'second', 'third']);
  });

  T('GRAM-3', 'a number option rejects non-numeric input instead of producing NaN', async () => {
    const r = await run(['ok', 'world', '--times', 'lots']);

    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--times');
    expect(r.stderr).toContain('number');
  });

  T('GRAM-3', 'an array option accumulates across repeats', async () => {
    expect((await parsed(['world', '--tag', 'a', '--tag', 'b'])).options.tag).toEqual(['a', 'b']);
    expect((await parsed(['world', '-t', 'a', '-t', 'b'])).options.tag).toEqual(['a', 'b']);
  });

  T('GRAM-3', 'repeating a non-array option is last-wins with a warning', async () => {
    const r = await run(['ok', 'world', '--out', 'first', '--out', 'second', '--json']);

    expect(r.json().data.options.out).toBe('second');
    expect(r.events().some(e => e.level === 'warn' && String(e.msg).includes('--out'))).toBe(true);
  });

  T('GRAM-3', 'a value outside the declared choices is a usage error', async () => {
    const r = await run(['ok', 'world', '--mode', 'reckless']);

    expect(r.code).toBe(2);
    expect(r.stderr).toContain('fast, safe');
  });

  T('GRAM-4', 'an undeclared option on a declared command is a usage error', async () => {
    // The typo that skips a deploy's confirmation flag.
    const r = await run(['ok', 'world', '--forse']);

    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--forse');
  });

  T('GRAM-4', 'a command that declares nothing keeps permissive parsing', async () => {
    const r = await run(['loose', 'a', '--anything', 'goes', '--flag', '--json']);

    expect(r.code).toBe(0);
    expect(r.json().data.options.anything).toBe('goes');
    expect(r.json().data.options.flag).toBe(true);
  });

  T('GRAM-4', 'the reserved flags are never an undeclared option', async () => {
    for (const flag of ['--json', '--verbose', '--quiet']) {
      const r = await run(['ok', 'world', flag]);
      expect(r.code).toBe(0);
    }
  });

  T('GRAM-5', 'execute does not run when an earlier stage fails', async () => {
    const r = await run(['ok', '--times', 'lots']);

    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
  });

  T('GRAM-5', 'a missing required argument names the argument', async () => {
    const r = await run(['ok']);

    expect(r.code).toBe(2);
    expect(r.stderr).toContain('who');
  });

  T('GRAM-6', 'subcommands resolve to the longest declared path', async () => {
    expect((await run(['group', 'inner'])).stdout).toBe('one\n');
    expect((await run(['group', 'inner', 'deeper'])).stdout).toBe('two\n');
  });

  T('GRAM-6', 'a subcommand alias resolves', async () => {
    expect((await run(['group', 'i'])).stdout).toBe('one\n');
  });

  T('GRAM-6', "a lazy command's alias resolves without loading the module", async () => {
    // 1.x had to load every lazy module to answer this, so it simply did not.
    const r = await run(['l']);

    expect(r.code).toBe(0);
    expect(r.stdout).toBe('loaded\n');
  });
});
