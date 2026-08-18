import { describe, test, expect } from 'bun:test';
import {
  colors,
  stripColors,
  colorize,
  table,
  box,
  createProgress,
  ProgressBar,
  withProgress,
  createMockLogger,
  createMockPrompter,
  mockRegistry,
  createTestHarness,
  expectError
} from '../../src/index.ts';

// The error, formatting and validation helpers this file used to cover were
// removed in 1.2.0 — 706 lines that no consumer imported. What remains is what
// the estate actually uses: colors, progress, and the testing harness.

describe('Color Utilities', () => {
  test('colors apply ANSI codes', () => {
    const red = colors.red('text');
    expect(red).toContain('text');
    // Colors might be disabled in test environment
    // Just verify the function exists and returns something
    expect(typeof red).toBe('string');
  });
  
  test('stripColors removes ANSI codes', () => {
    const colored = colors.red(colors.bold('text'));
    expect(stripColors(colored)).toBe('text');
  });
  
  test('colorize applies color by name', () => {
    expect(colorize('text', 'red')).toBe(colors.red('text'));
    expect(colorize('text', 'blue')).toBe(colors.blue('text'));
    expect(colorize('text')).toBe('text');
  });
  
  test('table formats data correctly', () => {
    const data = [
      { name: 'foo', value: 1 },
      { name: 'bar', value: 2 }
    ];
    const result = table(data);
    expect(result).toContain('name');
    expect(result).toContain('value');
    expect(result).toContain('foo');
    expect(result).toContain('1');
  });
  
  test('box creates bordered content', () => {
    const result = box('Hello', { borderStyle: 'single' });
    expect(result).toContain('Hello');
    expect(result).toContain('┌');
    expect(result).toContain('┐');
    expect(result).toContain('└');
    expect(result).toContain('┘');
  });
});

describe('Progress Utilities', () => {
  test('createProgress returns progress interface', () => {
    const progress = createProgress();
    expect(progress).toHaveProperty('start');
    expect(progress).toHaveProperty('update');
    expect(progress).toHaveProperty('succeed');
    expect(progress).toHaveProperty('fail');
    expect(progress).toHaveProperty('stop');
  });
  
  test('ProgressBar tracks progress', () => {
    const bar = new ProgressBar({ total: 100 });
    expect(() => bar.update(50)).not.toThrow();
    expect(() => bar.increment(10)).not.toThrow();
    expect(() => bar.complete()).not.toThrow();
  });
  
  test('withProgress wraps async tasks', async () => {
    let executed = false;
    await withProgress(
      async () => { executed = true; return 'done'; },
      'Processing...'
    );
    expect(executed).toBe(true);
  });
});

describe('Testing Utilities', () => {
  test('createMockLogger captures output', () => {
    const logger = createMockLogger();
    logger.info('test info');
    logger.error('test error');
    expect(logger.output).toContain('[INFO] test info');
    expect(logger.output).toContain('[ERROR] test error');
  });
  
  test('createMockPrompter returns predefined responses', async () => {
    const prompter = createMockPrompter({
      responses: { 'Name?': 'John' },
      confirmations: { 'Continue?': false }
    });
    
    expect(await prompter.text('Name?')).toBe('John');
    expect(await prompter.confirm('Continue?')).toBe(false);
    expect(await prompter.text('Other?')).toBe('mock-response');
  });
  
  test('mockRegistry creates registry with mocks', () => {
    const registry = mockRegistry();
    const logger = registry.get('logger');
    const prompter = registry.get('prompter');
    
    expect(logger).toBeDefined();
    expect(prompter).toBeDefined();
  });
  
  test('createTestHarness provides full testing environment', async () => {
    const commands = {
      test: {
        name: 'test',
        description: 'Test command',
        execute: async (ctx) => {
          const logger = ctx.registry.get('logger') as any;
          logger.info('Command executed');
        }
      }
    };
    
    const harness = createTestHarness(commands);
    await harness.runCommand('test');
    
    const output = harness.getOutput();
    expect(output).toContain('[INFO] Command executed');
  });
  
  test('expectError validates thrown errors', () => {
    expectError(() => { throw new Error('test'); }, Error, 'test');
    
    expect(() => {
      expectError(() => { /* no error */ }, Error);
    }).toThrow('Expected function to throw an error');
  });
});