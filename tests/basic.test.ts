import { test, expect, describe } from 'bun:test';
import { 
  createCLI, 
  createCommand, 
  ServiceRegistry, 
  createRegistry,
  LoggerToken,
  createLogger
} from '../src/index.ts';

describe('@merlin/cli', () => {
  test('createCLI creates a CLI instance', () => {
    const cli = createCLI({
      name: 'test-cli',
      version: '1.0.0'
    });

    expect(cli).toBeDefined();
    expect(cli.run).toBeInstanceOf(Function);
    expect(cli.registry).toBeInstanceOf(ServiceRegistry);
    expect(cli.commands).toBeDefined();
  });

  test('service registry works', () => {
    const registry = createRegistry();
    const testService = { value: 42 };
    
    registry.register('test', testService);
    expect(registry.get('test')).toBe(testService);
    expect(registry.has('test')).toBe(true);
  });

  test('logger service works', () => {
    const logger = createLogger({ silent: true });
    
    // Should not throw
    logger.info('test');
    logger.error('test');
    logger.warn('test');
    logger.debug('test');
    logger.success('test');
  });

  test('createCommand creates valid command', () => {
    const command = createCommand({
      name: 'test',
      description: 'Test command',
      examples: ['test example1', 'test example2'],
      execute: () => {
        return 'executed';
      }
    });

    expect(command.name).toBe('test');
    expect(command.description).toBe('Test command');
    expect(command.examples).toHaveLength(2);
    expect(command.execute).toBeInstanceOf(Function);
  });

  test('command execution with context', async () => {
    let capturedContext: any;
    
    const command = createCommand({
      name: 'capture',
      description: 'Captures context',
      execute: (context) => {
        capturedContext = context;
        return 'done';
      }
    });

    const registry = createRegistry();
    registry.register(LoggerToken, createLogger({ silent: true }));
    
    const result = await command.execute({
      args: ['arg1', 'arg2'],
      options: { flag: true },
      registry
    });

    expect(result).toBe('done');
    expect(capturedContext).toBeDefined();
    expect(capturedContext.args).toEqual(['arg1', 'arg2']);
    expect(capturedContext.options).toEqual({ flag: true });
    expect(capturedContext.registry).toBe(registry);
  });
});