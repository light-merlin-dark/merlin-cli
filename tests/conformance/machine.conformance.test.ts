import { expect, describe, beforeAll } from 'bun:test';
import { T, runScript, ensurePacked } from './harness.ts';
import { FIXTURE } from './fixtures.ts';

const run = (args: string[], options = {}) => runScript(FIXTURE, args, options);

describe('MODE — every CLI speaks JSON', () => {
  beforeAll(async () => { await ensurePacked(); }, 180_000);

  T('MODE-1', 'stdout carries exactly one JSON document', async () => {
    const r = await run(['ok', 'world', '--json']);

    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.stdout.endsWith('\n')).toBe(true);
  });

  T('MODE-1', 'the envelope has the declared shape and nothing else', async () => {
    const envelope = (await run(['ok', 'world', '--json'])).json();

    expect(Object.keys(envelope)).toEqual(['ok', 'code', 'command', 'data', 'error', 'cli']);
    expect(envelope.command).toBe('ok');
    expect(envelope.cli).toEqual({ name: 'fixture', version: '2.0.0', contract: '2.0' });
  });

  T('MODE-1', 'data is the return value minus the outcome keys', async () => {
    const envelope = (await run(['returned-false', '--json'])).json();

    // `{ success: false, error: 'upstream refused' }` is outcome signalling, so
    // there is no payload — the message belongs in `error`.
    expect(envelope.data).toBeNull();
    expect(envelope.error.message).toBe('upstream refused');
  });

  T('MODE-1', 'a failure reported only through the logger still has an error message', async () => {
    const envelope = (await run(['reported', '--json'])).json();
    expect(envelope.ok).toBe(false);
    expect(envelope.error.message).toBe('zone not found');
  });

  T('MODE-1', 'a stack is withheld unless --verbose asks for it', async () => {
    const quiet = (await run(['thrower', '--json'])).json();
    expect(quiet.error.stack).toBeUndefined();

    const loud = (await run(['thrower', '--json', '--verbose'])).json();
    expect(loud.error.stack).toContain('exploded');
  });

  T('MODE-2', 'commentary becomes NDJSON events on stderr', async () => {
    const r = await run(['chatty', '--json']);
    const events = r.events();

    expect(events).toContainEqual({ ev: 'log', level: 'info', msg: 'info line' });
    expect(events).toContainEqual({ ev: 'log', level: 'warn', msg: 'warn line' });
    for (const line of r.stderr.trim().split('\n')) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  T('MODE-2', 'a stray console.log is relayed to stderr instead of corrupting the document', async () => {
    // Consumers print with console.log everywhere and cannot all be rewritten;
    // making the framework own the channel is what lets --json work on day one.
    const r = await run(['prints', '--json']);

    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.json().data).toEqual({ printed: true });
    expect(r.events()).toContainEqual({ ev: 'out', text: 'direct stdout line' });
  });

  T('MODE-3', 'each emitted item is one line, and the envelope is the last', async () => {
    const r = await run(['streamer', '--ndjson', '--count', '5']);
    const lines = r.stdout.trim().split('\n');

    expect(lines).toHaveLength(6);
    expect(lines.slice(0, 5).map(line => JSON.parse(line))).toEqual([
      { i: 0 }, { i: 1 }, { i: 2 }, { i: 3 }, { i: 4 }
    ]);
    expect(JSON.parse(lines[5]).ok).toBe(true);
  });

  T('MODE-4', 'a pipe does not switch the output shape', async () => {
    // stdout is a pipe in every one of these runs. Text mode stays text mode.
    const r = await run(['ok', 'world']);
    expect(r.stdout).toBe('hello world\n');
    expect(() => JSON.parse(r.stdout)).toThrow();
  });

  T('MODE-5', "a command that declares --json keeps its own meaning", async () => {
    const r = await run(['owns-json', '--json', 'path/to/file']);

    expect(r.stdout).toBe('json=path/to/file\n');
    expect(r.code).toBe(0);
  });

  T('MODE-5', 'the manifest records the shadowing', async () => {
    const manifest = (await run(['manifest'])).json();
    const shadower = manifest.commands.find((c: any) => c.name === 'owns-json');

    expect(shadower.shadows).toContain('json');
  });

  T('MODE-6', 'help, version and manifest all honour --json', async () => {
    const version = (await run(['version', '--json'])).json();
    expect(version.data).toEqual({ name: 'fixture', version: '2.0.0' });

    const help = (await run(['help', 'ok', '--json'])).json();
    expect(help.data.name).toBe('ok');
    expect(help.data.args[0].name).toBe('who');

    const manifest = (await run(['manifest', '--json'])).json();
    expect(manifest.data.$schema).toBe('merlin-cli/manifest/v2');
  });
});
