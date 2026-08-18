#!/usr/bin/env bun
/**
 * Fixture CLI spawned by tests/integration/exit-code.test.ts.
 *
 * Exercised as a real child process so the assertions are on the actual
 * process exit status a shell, CI gate or agent would observe — not on a
 * value returned inside the test runner.
 */
import { createCLI } from '../../src/index.ts';

const cli = createCLI({
  name: 'exit-code-fixture',
  version: '0.0.0',
  plugins: { enabled: false },
  commands: {
    ok: {
      name: 'ok',
      description: 'Returns a plain data payload',
      execute: () => ({ zones: ['a', 'b'], count: 2 })
    },
    'ok-void': {
      name: 'ok-void',
      description: 'Returns nothing at all',
      execute: () => {
        console.log('did the thing');
      }
    },
    'ok-success': {
      name: 'ok-success',
      description: 'Returns an explicit success result',
      execute: () => ({ success: true, message: 'done' })
    },
    fail: {
      name: 'fail',
      description: 'Reports failure by returning a result (the cf zone create shape)',
      execute: () => {
        console.error('❌ Requires permission com.cloudflare.api.account.zone.create');
        return { success: false, error: 'Requires permission' };
      }
    },
    'fail-code': {
      name: 'fail-code',
      description: 'Reports failure with an explicit exit code',
      execute: () => ({ success: false, exitCode: 42, error: 'explicit code' })
    },
    'fail-code-only': {
      name: 'fail-code-only',
      description: 'Reports an exit code without a success flag',
      execute: () => ({ exitCode: 7 })
    },
    'fail-async': {
      name: 'fail-async',
      description: 'Reports failure from an async handler',
      execute: async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return { success: false, error: 'async failure' };
      }
    },
    boom: {
      name: 'boom',
      description: 'Fails by throwing',
      execute: () => {
        throw new Error('exploded');
      }
    }
  }
});

await cli.run();
