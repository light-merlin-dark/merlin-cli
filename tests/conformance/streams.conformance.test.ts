import { expect, describe, beforeAll } from 'bun:test';
import { T, runScript, ensurePacked } from './harness.ts';
import { FIXTURE } from './fixtures.ts';

const run = (args: string[], options = {}) => runScript(FIXTURE, args, options);
const ESC = '\u001b';

describe('STREAM — payload and commentary', () => {
  beforeAll(async () => { await ensurePacked(); }, 180_000);

  T('STREAM-1', 'stdout carries only the rendered payload', async () => {
    const r = await run(['chatty']);
    expect(r.stdout).toBe('payload:42\n');
  });

  T('STREAM-2', 'every logger level goes to stderr, including info and success', async () => {
    const r = await run(['chatty']);

    for (const line of ['info line', 'success line', 'warn line']) {
      expect(r.stderr).toContain(line);
      expect(r.stdout).not.toContain(line);
    }
  });

  T('STREAM-2', 'errors go to stderr', async () => {
    const r = await run(['reported']);
    expect(r.stderr).toContain('zone not found');
    expect(r.stdout).toBe('');
  });

  T('STREAM-3', 'a command with no payload writes nothing to stdout', async () => {
    // `$(mycli deploy)` capturing an empty string is the correct behaviour.
    expect((await run(['silent'])).stdout).toBe('');
  });

  T('STREAM-4', 'a prompt is written to stderr, never stdout', async () => {
    const r = await run(['asks']);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Proceed?');
  });
});

describe('ENV — adapt the paint, not the shape', () => {
  beforeAll(async () => { await ensurePacked(); }, 180_000);

  T('ENV-1', 'no ANSI bytes reach a pipe', async () => {
    // Both streams are pipes under a spawned process, so nothing may be styled.
    const r = await run(['chatty'], { env: { NO_COLOR: undefined } });
    expect(r.stdout).not.toContain(ESC);
    expect(r.stderr).not.toContain(ESC);
  });

  T('ENV-1', 'NO_COLOR suppresses colour even when it is forced on elsewhere', async () => {
    const r = await run(['chatty'], { env: { NO_COLOR: '1', TERM: 'xterm-256color' } });
    expect(r.stderr).not.toContain(ESC);
  });

  T('ENV-1', 'FORCE_COLOR overrides the absence of a TTY', async () => {
    const r = await run(['chatty'], { env: { NO_COLOR: undefined, FORCE_COLOR: '1' } });
    expect(r.stderr).toContain(ESC);
  });

  T('ENV-1', 'TERM=dumb suppresses colour', async () => {
    const r = await run(['chatty'], { env: { NO_COLOR: undefined, TERM: 'dumb' } });
    expect(r.stderr).not.toContain(ESC);
  });

  T('ENV-2', 'progress writes nothing when stderr is not a terminal', async () => {
    const r = await runScript(
      `import { createProgress } from __DIST__;\n` +
        `const p = createProgress();\n` +
        `p.start('working'); p.update('still'); p.stop();\n` +
        `console.log('done');\n`
    );

    expect(r.stdout).toBe('done\n');
    expect(r.stderr).not.toContain(ESC);
  });

  T('ENV-3', 'output shape does not change because stdout is a pipe', async () => {
    // MODE-4's other half: piped text mode is still text mode, and piped JSON
    // is still JSON. Nothing auto-switches.
    const piped = await run(['ok', 'world']);
    expect(piped.stdout).toBe('hello world\n');
  });

  T('ENV-4', 'an option can declare an environment fallback, and the manifest says so', async () => {
    const fromEnv = await run(['ok', 'world', '--json'], { env: { FIXTURE_TOKEN: 'from-env' } });
    expect(fromEnv.json().data.options.token).toBe('from-env');

    const manifest = (await run(['manifest'])).json();
    const token = manifest.commands
      .find((c: any) => c.name === 'ok')
      .options.find((o: any) => o.name === 'token');
    expect(token.env).toBe('FIXTURE_TOKEN');
  });

  T('ENV-4', 'an explicit flag beats the environment fallback', async () => {
    const r = await run(['ok', 'world', '--token', 'explicit', '--json'], {
      env: { FIXTURE_TOKEN: 'from-env' }
    });
    expect(r.json().data.options.token).toBe('explicit');
  });
});
