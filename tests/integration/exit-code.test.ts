import { test, expect, describe } from 'bun:test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../fixtures/exit-code-cli.ts', import.meta.url));

async function runFixture(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', FIXTURE, ...args], {
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ]);

  const code = await proc.exited;

  return { code, stdout, stderr };
}

/**
 * These assert the exit status of a real child process — the thing a shell,
 * a CI gate or an agent checking `$?` actually sees.
 */
describe('process exit status', () => {
  test('a command returning success: false exits non-zero', async () => {
    const { code, stderr } = await runFixture(['fail']);

    expect(code).not.toBe(0);
    expect(code).toBe(1);
    expect(stderr).toContain('Requires permission');
  });

  test('an async command returning success: false exits non-zero', async () => {
    const { code } = await runFixture(['fail-async']);
    expect(code).toBe(1);
  });

  test('an explicit exitCode reaches the shell', async () => {
    expect((await runFixture(['fail-code'])).code).toBe(42);
    expect((await runFixture(['fail-code-only'])).code).toBe(7);
  });

  test('a command returning data exits 0', async () => {
    expect((await runFixture(['ok'])).code).toBe(0);
  });

  test('a command returning nothing exits 0', async () => {
    const { code, stdout } = await runFixture(['ok-void']);
    expect(code).toBe(0);
    expect(stdout).toContain('did the thing');
  });

  test('a command returning success: true exits 0', async () => {
    expect((await runFixture(['ok-success'])).code).toBe(0);
  });

  test('a thrown error exits non-zero', async () => {
    expect((await runFixture(['boom'])).code).toBe(1);
  });
});
