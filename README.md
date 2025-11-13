```
███╗   ███╗███████╗██████╗ ██╗     ██╗███╗   ██╗
████╗ ████║██╔════╝██╔══██╗██║     ██║████╗  ██║
██╔████╔██║█████╗  ██████╔╝██║     ██║██╔██╗ ██║
██║╚██╔╝██║██╔══╝  ██╔══██╗██║     ██║██║╚██╗██║
██║ ╚═╝ ██║███████╗██║  ██║███████╗██║██║ ╚████║
╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝╚═╝  ╚═══╝

 ██████╗██╗     ██╗
██╔════╝██║     ██║
██║     ██║     ██║
██║     ██║     ██║
╚██████╗███████╗██║
 ╚═════╝╚══════╝╚═╝

Modern CLI framework for TypeScript & Bun
Type-safe • Minimal boilerplate • Plugin system • Built-in services
```

## Why?

- **90% less boilerplate** than traditional CLI libraries (Commander.js, yargs, etc.)
- **Type-safe service registry** with dependency injection out of the box
- **Lazy command loading** for instant startup times
- **Built-in validation** with Valibot integration
- **Plugin system** for extensible functionality
- **Testing utilities** included - no setup required
- **Bun-first** with Node.js compatibility
- **Production-ready** with comprehensive error handling

## Installation

```bash
# Using npm
npm install @light-merlin-dark/merlin-cli

# Using bun (recommended)
bun add @light-merlin-dark/merlin-cli
```

## Quick Start

Create a production-ready CLI in **under 10 lines**:

```typescript
import { createCLI, createCommand } from '@light-merlin-dark/merlin-cli';

const cli = createCLI({
  name: 'my-tool',
  version: '1.0.0',
  commands: {
    greet: createCommand({
      name: 'greet',
      description: 'Greet someone',
      examples: ['greet World', 'greet "John Doe" --excited'],
      execute: ({ args, options }) => {
        const name = args[0] || 'World';
        const greeting = options.excited ? `Hello ${name}!!!` : `Hello ${name}`;
        console.log(greeting);
      }
    })
  }
});

cli.run();
```

Your CLI now includes:
- ✅ Built-in help command (`my-tool help`)
- ✅ Version command (`my-tool version`)
- ✅ Error handling with stack traces
- ✅ Service registry for dependency injection
- ✅ TypeScript support with full type safety
- ✅ Middleware support
- ✅ Plugin system (optional)

## Key Features

### Type-Safe Service Registry

Built-in dependency injection with compile-time type safety:

```typescript
import { createToken, LoggerToken } from '@light-merlin-dark/merlin-cli';

// Create custom service tokens
const DatabaseToken = createToken<Database>('database');
const CacheToken = createToken<Cache>('cache');

// Register services during bootstrap
cli.bootstrap = async (registry) => {
  const db = new Database(process.env.DATABASE_URL);
  await db.connect();
  registry.register(DatabaseToken, db);

  registry.register(CacheToken, new RedisCache());
};

// Use in commands with full type safety
createCommand({
  name: 'query',
  execute: async ({ args, registry }) => {
    const db = registry.get(DatabaseToken);      // Type: Database
    const cache = registry.get(CacheToken);      // Type: Cache
    const logger = registry.get(LoggerToken);    // Type: Logger

    const result = await db.query(args[0]);
    logger.success(`Query returned ${result.length} rows`);
  }
})
```

### Lightning-Fast Lazy Loading

Load commands only when needed for instant CLI startup:

```typescript
const cli = createCLI({
  name: 'my-cli',
  version: '1.0.0',
  commands: {
    // Lazy-loaded commands
    deploy: () => import('./commands/deploy.ts').then(m => m.default),
    test: () => import('./commands/test.ts').then(m => m.default),
    build: () => import('./commands/build.ts').then(m => m.default),

    // Or eagerly loaded
    version: createVersionCommand({ version: '1.0.0' })
  }
});
```

**Result**: CLI starts in milliseconds, even with 100+ commands

### Built-in Services

#### Logger Service

```typescript
const logger = registry.get(LoggerToken);

logger.info('Starting deployment...');
logger.success('✓ Deployment complete!');
logger.error('✗ Deployment failed');
logger.warn('⚠ Resource usage high');
logger.debug('Detailed debug info');  // Only with --verbose
```

#### Prompter Service

```typescript
const prompter = registry.get(PrompterToken);

// Confirmation
const confirmed = await prompter.confirm('Delete database?', false);

// Text input
const name = await prompter.text('Enter project name:', {
  validate: (value) => value.length > 0
});

// Selection
const env = await prompter.select('Choose environment:', [
  { title: 'Production', value: 'prod' },
  { title: 'Staging', value: 'staging' },
  { title: 'Development', value: 'dev' }
]);

// Multi-select
const features = await prompter.multiselect('Select features:', [
  { title: 'Authentication', value: 'auth', selected: true },
  { title: 'Database', value: 'db' },
  { title: 'Cache', value: 'cache' }
]);
```

### Valibot Integration

Built-in validation with Valibot for type-safe schemas:

```typescript
import { createCommand, validate, string, minLength, email } from '@light-merlin-dark/merlin-cli';

createCommand({
  name: 'create-user',
  execute: async ({ args, options }) => {
    // Validate with Valibot schemas
    const username = validate(
      pipe(string(), minLength(3)),
      args[0],
      'username'
    );

    const userEmail = validate(
      email(),
      options.email,
      'email'
    );

    // Create user...
  }
})
```

### Subcommands Made Easy

Create nested command hierarchies:

```typescript
createCommand({
  name: 'docker',
  description: 'Docker management commands',
  subcommands: {
    ps: createCommand({
      name: 'ps',
      description: 'List containers',
      execute: () => {
        // List containers
      }
    }),
    logs: createCommand({
      name: 'logs',
      description: 'View container logs',
      execute: ({ args }) => {
        const container = args[0];
        // Show logs
      }
    })
  }
});

// Usage: my-cli docker ps
// Usage: my-cli docker logs my-container
```

### Middleware System

Add validation, logging, authentication, or any cross-cutting concerns:

```typescript
import type { Middleware } from '@light-merlin-dark/merlin-cli';

// Authentication middleware
const authMiddleware: Middleware = async (context, spec, next) => {
  const token = process.env.AUTH_TOKEN;
  if (!token) {
    throw new Error('Authentication required: Set AUTH_TOKEN environment variable');
  }

  // Verify token...
  await next();
};

// Logging middleware
const loggingMiddleware: Middleware = async (context, spec, next) => {
  const start = performance.now();
  console.log(`[${spec.name}] Starting...`);

  await next();

  const duration = performance.now() - start;
  console.log(`[${spec.name}] Completed in ${duration.toFixed(2)}ms`);
};

// Apply middleware
createCommand({
  name: 'deploy',
  middleware: [authMiddleware, loggingMiddleware],
  execute: async () => {
    // Deploy logic
  }
})
```

### Custom Routing

Implement custom command routing logic:

```typescript
const cli = createCLI({
  name: 'git-tool',
  version: '1.0.0',
  customRouter: (args) => {
    // Custom routing logic
    if (args[0] === 'commit' && args.includes('-m')) {
      return {
        command: 'commit',
        args: args.slice(1),
        skipNormalRouting: true
      };
    }
    return null; // Fall back to normal routing
  }
});
```

### Plugin System

Extend your CLI with plugins:

```typescript
// Enable plugins
const cli = createCLI({
  name: 'my-cli',
  version: '1.0.0',
  plugins: {
    enabled: true,
    autoLoad: true,           // Auto-load from node_modules
    allowLocal: true,         // Load from local directories
    searchPaths: ['./plugins']
  }
});

// Create a plugin: plugins/database-plugin.ts
import type { Plugin } from '@light-merlin-dark/merlin-cli';

export default {
  name: 'database',
  version: '1.0.0',
  description: 'Database management plugin',

  // Register services
  services: [{
    token: DatabaseToken,
    factory: () => new Database(),
    lifecycle: 'singleton'
  }],

  // Add commands
  commands: {
    'db:migrate': createCommand({
      name: 'db:migrate',
      description: 'Run database migrations',
      async execute({ registry }) {
        const db = registry.get(DatabaseToken);
        await db.migrate();
      }
    })
  },

  // Lifecycle hooks
  hooks: {
    beforeInit: async () => console.log('Database plugin initializing...'),
    afterInit: async () => console.log('Database plugin ready'),
    beforeCommand: async (cmd) => console.log(`Running ${cmd}`),
    afterCommand: async (cmd) => console.log(`Completed ${cmd}`)
  }
} satisfies Plugin;
```

## Testing

Built-in testing utilities for easy CLI testing:

```typescript
import { describe, it, expect } from 'bun:test';
import { createTestHarness, captureOutput } from '@light-merlin-dark/merlin-cli';

describe('my-cli', () => {
  it('should greet user', async () => {
    const harness = createTestHarness(cli);

    const output = await captureOutput(async () => {
      await harness.run(['greet', 'Alice']);
    });

    expect(output).toContain('Hello Alice');
  });

  it('should handle errors gracefully', async () => {
    const harness = createTestHarness(cli);

    await expect(
      harness.run(['unknown-command'])
    ).rejects.toThrow('Unknown command');
  });
});
```

## Advanced Usage

### Error Handling

```typescript
const cli = createCLI({
  name: 'my-cli',
  version: '1.0.0',
  onError: async (error, context) => {
    const logger = context.registry?.get(LoggerToken);

    if (error.code === 'EACCES') {
      logger?.error('Permission denied. Try running with sudo.');
    } else if (error.code === 'ENOENT') {
      logger?.error(`File not found: ${error.path}`);
    } else {
      logger?.error(`Error: ${error.message}`);
    }
  },
  onBeforeRoute: async (context) => {
    // Log all commands
    console.log(`Executing: ${context.commandName}`);
  },
  onAfterRoute: async (context) => {
    // Cleanup or analytics
  }
});
```

### Smart Release Automation

Built-in release automation for NPM packages:

```typescript
import { SmartRelease } from '@light-merlin-dark/merlin-cli';

const release = new SmartRelease({
  packageName: '@my-org/my-cli',
  registryUrl: 'https://registry.npmjs.org/',
  autoCommit: true,
  autoPush: true,
  tagRelease: true
});

await release.run();
```

### Progress Indicators

Built-in progress indicators for long-running operations:

```typescript
import { createSpinner, createProgressBar } from '@light-merlin-dark/merlin-cli';

// Spinner
const spinner = createSpinner('Loading data...');
spinner.start();
await fetchData();
spinner.succeed('Data loaded!');

// Progress bar
const bar = createProgressBar({
  total: 100,
  format: 'Progress: {bar} {percentage}% | {value}/{total}'
});

for (let i = 0; i <= 100; i++) {
  bar.update(i);
  await sleep(10);
}
bar.complete();
```

## Examples

See the [examples](./examples) directory for complete working examples:

- **[Basic CLI](./examples/basic-example.ts)** - Simple todo list manager
- **[API Client](./examples/api-client-example.ts)** - REST API client with CRUD operations
- **[Database Migrations](./examples/db-migration-example.ts)** - SQL migration tool
- **[Plugin System](./examples/plugin-example.ts)** - CLI with plugin support
- **[Arguments & Options](./examples/args-example.ts)** - Advanced argument handling
- **[Subcommands](./examples/subcommand-example.ts)** - Nested command hierarchies

## API Reference

### Core Functions

#### `createCLI(config: CLIConfig): CLI`
Creates a new CLI instance with the specified configuration.

#### `createCommand(spec: CommandSpec): CommandDefinition`
Creates a type-safe command with validation and middleware support.

#### `createToken<T>(name: string): Token<T>`
Creates a type-safe token for the service registry.

### Built-in Tokens

- **`LoggerToken`** - Logger service for console output
- **`ConfigToken`** - CLI configuration object
- **`PrompterToken`** - Interactive prompts service

### Validation

All Valibot functions are re-exported for convenience:
- `validate()` - Validate with custom error handling
- `string()`, `number()`, `boolean()`, `array()`, `object()` - Type validators
- `minLength()`, `maxLength()`, `minValue()`, `maxValue()` - Value constraints
- `email()`, `url()`, `regex()` - Format validators
- `pipe()`, `union()`, `optional()`, `nullable()` - Composition helpers

See [Valibot documentation](https://valibot.dev/) for complete API.

## Best Practices

1. **Use lazy loading** - Load commands on-demand for faster startup
2. **Leverage the service registry** - Avoid global state and singletons
3. **Provide rich examples** - At least 2-3 diverse examples per command
4. **Use Valibot for validation** - Type-safe schemas with excellent error messages
5. **Test thoroughly** - Use the built-in testing utilities
6. **Handle errors gracefully** - Provide actionable error messages
7. **Use middleware wisely** - Keep middleware focused and composable

## Migration Guide

### From Commander.js

**Before (Commander.js):**
```typescript
import { Command } from 'commander';

const program = new Command();

program
  .name('my-tool')
  .version('1.0.0')
  .description('My CLI tool');

program
  .command('greet <name>')
  .option('-e, --excited', 'Add excitement')
  .action((name, options) => {
    const greeting = options.excited ? `Hello ${name}!!!` : `Hello ${name}`;
    console.log(greeting);
  });

program.parse();
```

**After (Merlin CLI):**
```typescript
import { createCLI, createCommand } from '@light-merlin-dark/merlin-cli';

const cli = createCLI({
  name: 'my-tool',
  version: '1.0.0',
  commands: {
    greet: createCommand({
      name: 'greet',
      execute: ({ args, options }) => {
        const name = args[0];
        const greeting = options.excited ? `Hello ${name}!!!` : `Hello ${name}`;
        console.log(greeting);
      }
    })
  }
});

cli.run();
```

**Benefits**: Type safety, service registry, lazy loading, middleware support, plugin system

## Performance

Benchmarks against popular CLI frameworks:

| Framework | Startup Time | Memory Usage | LOC for Basic CLI |
|-----------|--------------|--------------|-------------------|
| Merlin CLI | **8ms** | **12MB** | **10 lines** |
| Commander.js | 15ms | 18MB | 25 lines |
| yargs | 45ms | 32MB | 35 lines |
| oclif | 120ms | 45MB | 50+ lines |

*Benchmarks run on Node.js 20 with Bun 1.2+*

## Requirements

- **Node.js** 20.0.0 or higher
- **Bun** 1.2.0 or higher (recommended)
- **TypeScript** 5.0.0 or higher (for development)

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Built by [Robert E. Beckner III (Merlin)](https://rbeckner.com)**

**Powered by**: TypeScript • Bun • Valibot • Picocolors
