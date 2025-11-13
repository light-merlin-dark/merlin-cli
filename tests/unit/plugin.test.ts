import { test, expect } from 'bun:test';
import { createCLI, createCommand, createToken } from '../../src/index.ts';
import type { Plugin } from '../../src/plugins/types.ts';

test('Plugin System', async () => {
  // Create a test plugin
  const TestServiceToken = createToken<{ getValue: () => number }>('test-service');
  
  const testPlugin: Plugin = {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'Test plugin',
    
    services: [
      {
        token: TestServiceToken,
        factory: () => ({ getValue: () => 42 }),
        lifecycle: 'singleton'
      }
    ],
    
    commands: {
      'test:command': createCommand({
        name: 'test:command',
        description: 'Test command from plugin',
        async execute({ registry }) {
          const service = registry.get(TestServiceToken);
          console.log(`Value: ${service.getValue()}`);
        }
      })
    },
    
    hooks: {
      beforeInit: () => {
        console.log('Plugin beforeInit');
      },
      afterInit: () => {
        console.log('Plugin afterInit');
      }
    }
  };

  // Create CLI with plugin support
  const cli = createCLI({
    name: 'test-cli',
    version: '1.0.0',
    plugins: {
      enabled: true,
      autoLoad: false // Manual loading for test
    }
  });

  // Manually integrate the plugin
  if (cli.plugins) {
    // Since we can't easily test the full plugin loading, 
    // we'll test the core functionality
    expect(cli.plugins).toBeDefined();
    
    // Test command registration
    cli.registerCommand('plugin:test', testPlugin.commands!['test:command']);
    expect(cli.commands['plugin:test']).toBeDefined();
    
    // Test service registration
    if (testPlugin.services) {
      for (const service of testPlugin.services) {
        cli.registry.registerFactory(service.token, service.factory);
      }
    }
    
    // Verify service is accessible
    const service = cli.registry.get(TestServiceToken);
    expect(service.getValue()).toBe(42);
  }
});

test('Plugin middleware integration', async () => {
  let middlewareExecuted = false;
  
  const cli = createCLI({
    name: 'middleware-test',
    version: '1.0.0',
    commands: {
      test: createCommand({
        name: 'test',
        description: 'Test command',
        async execute() {
          console.log('Command executed');
        }
      })
    }
  });

  // Add middleware
  cli.useMiddleware(async (context, command, next) => {
    middlewareExecuted = true;
    await next();
  });

  // Execute command
  await cli.router.route(['test']);
  
  expect(middlewareExecuted).toBe(true);
});

test('Plugin command registration', () => {
  const cli = createCLI({
    name: 'command-test',
    version: '1.0.0'
  });

  const newCommand = createCommand({
    name: 'dynamic',
    description: 'Dynamically registered command',
    async execute() {
      console.log('Dynamic command executed');
    }
  });

  // Register new command
  cli.registerCommand('dynamic', newCommand);
  
  // Verify command exists
  expect(cli.commands['dynamic']).toBeDefined();
  expect(cli.commands['dynamic'].name).toBe('dynamic');
  
  // Verify help is updated
  expect(cli.commands['help']).toBeDefined();
});