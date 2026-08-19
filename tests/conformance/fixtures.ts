/**
 * The CLI the conformance suite runs against.
 *
 * It is source text rather than a module because it is executed in a separate
 * process, importing the packed tarball the way a consumer's `node_modules`
 * would. A closure captured here would not survive that boundary.
 */
export const FIXTURE = `
import { createCLI, createCommand, lazy, LoggerToken, PrompterToken } from __DIST__;

const ok = createCommand({
  name: 'ok',
  description: 'returns data',
  args: { who: { type: 'string', description: 'subject', required: true } },
  options: {
    times: { type: 'number', description: 'repeat', default: 1, alias: 'n' },
    tag: { type: 'array', description: 'labels', alias: 't' },
    force: { type: 'boolean', description: 'skip checks', alias: 'f' },
    all: { type: 'boolean', description: 'everything', alias: 'a' },
    out: { type: 'string', description: 'destination', alias: 'o' },
    cache: { type: 'boolean', description: 'use cache', default: true },
    mode: { type: 'string', description: 'strategy', choices: ['fast', 'safe'] },
    token: { type: 'string', description: 'credential', env: 'FIXTURE_TOKEN' }
  },
  examples: ['ok world', 'ok world --json'],
  exitCodes: { 4: 'partial' },
  render: (data) => 'hello ' + data.who,
  execute: ({ namedArgs, options, args, argv }) => ({ who: namedArgs.who, options, args, argv })
});

const chatty = createCommand({
  name: 'chatty',
  description: 'logs at every level then returns data',
  render: (data) => 'payload:' + data.value,
  execute: ({ registry }) => {
    const log = registry.get(LoggerToken);
    log.info('info line');
    log.success('success line');
    log.warn('warn line');
    log.debug('debug line');
    return { value: 42 };
  }
});

const silentCommand = createCommand({
  name: 'silent',
  description: 'returns nothing at all',
  execute: () => undefined
});

const reported = createCommand({
  name: 'reported',
  description: 'reports an error and returns nothing',
  execute: ({ registry }) => { registry.get(LoggerToken).error('zone not found'); }
});

const returnedFalse = createCommand({
  name: 'returned-false',
  description: 'returns success false',
  execute: () => ({ success: false, error: 'upstream refused' })
});

const coded = createCommand({
  name: 'coded',
  description: 'returns an explicit exit code',
  options: { code: { type: 'number', description: 'code to return', default: 4 } },
  execute: ({ options }) => ({ exitCode: options.code })
});

const thrower = createCommand({
  name: 'thrower',
  description: 'throws',
  execute: () => { throw new Error('exploded'); }
});

const streamer = createCommand({
  name: 'streamer',
  description: 'emits items',
  options: { count: { type: 'number', description: 'how many', default: 3 } },
  render: (data) => JSON.stringify(data),
  execute: ({ emit, options }) => {
    for (let i = 0; i < options.count; i++) emit({ i });
  }
});

const prints = createCommand({
  name: 'prints',
  description: 'writes straight to stdout',
  execute: () => { console.log('direct stdout line'); return { printed: true }; }
});

const asks = createCommand({
  name: 'asks',
  description: 'prompts for confirmation',
  execute: async ({ registry }) => ({ yes: await registry.get(PrompterToken).confirm('Proceed?') })
});

const ownsJson = createCommand({
  name: 'owns-json',
  description: 'declares its own json option',
  options: { json: { type: 'string', description: 'a path, not a mode' } },
  render: (data) => 'json=' + data.json,
  execute: ({ options }) => ({ json: options.json ?? null })
});

const lingers = createCommand({
  name: 'lingers',
  description: 'leaves a timer running',
  execute: () => { setInterval(() => {}, 1000); return { started: true }; }
});

const sleeps = createCommand({
  name: 'sleeps',
  description: 'waits, honouring the abort signal',
  execute: async ({ signal }) => {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000);
      signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); });
    });
    return { finished: true };
  }
});

const group = {
  name: 'group',
  description: 'groups subcommands',
  subcommands: {
    inner: createCommand({
      name: 'inner',
      description: 'nested one level',
      aliases: ['i'],
      subcommands: {
        deeper: createCommand({
          name: 'deeper',
          description: 'nested two levels',
          render: (data) => data.depth,
          execute: () => ({ depth: 'two' })
        })
      },
      render: (data) => data.depth,
      execute: () => ({ depth: 'one' })
    })
  }
};

const loose = {
  name: 'loose',
  description: 'declares nothing, parses permissively',
  execute: ({ args, options }) => ({ args, options })
};

const cli = createCLI({
  name: 'fixture',
  version: '2.0.0',
  description: 'conformance fixture',
  commands: {
    ok,
    chatty,
    silent: silentCommand,
    reported,
    'returned-false': returnedFalse,
    coded,
    thrower,
    streamer,
    prints,
    asks,
    'owns-json': ownsJson,
    lingers,
    sleeps,
    group,
    loose,
    later: lazy({
      name: 'later',
      description: 'loads on first use',
      aliases: ['l'],
      options: { shout: { type: 'boolean', description: 'upper case' } },
      examples: ['later'],
      load: async () => createCommand({
        name: 'later',
        description: 'loads on first use',
        render: (data) => data.word,
        execute: () => ({ word: 'loaded' })
      })
    })
  }
});

await cli.run();
`;

/** A CLI with `n` described-lazy commands, for the startup-cost clause. */
export function scaleFixture(count: number): string {
  const entries = Array.from({ length: count }, (_, i) =>
    `  cmd${i}: lazy({ name: 'cmd${i}', description: 'command ${i}', load: async () => { throw new Error('must not load'); } })`
  ).join(',\n');

  return `
import { createCLI, lazy } from __DIST__;
const cli = createCLI({
  name: 'scale',
  version: '2.0.0',
  commands: {
${entries}
  }
});
await cli.run();
`;
}
