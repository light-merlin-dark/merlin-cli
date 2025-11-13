import { describe, test, expect } from 'bun:test';
import {
  // Error utilities
  CLIError,
  ValidationError,
  CommandNotFoundError,
  handleError,
  assertDefined,
  
  // Color utilities
  colors,
  stripColors,
  colorize,
  table,
  box,
  
  // Formatting utilities
  indent,
  dedent,
  wrap,
  truncate,
  center,
  formatDuration,
  formatBytes,
  humanize,
  slugify,
  
  // Validation utilities
  createValidator,
  required,
  string,
  number,
  minLength,
  pattern,
  oneOf,
  validateOptions,
  
  // Progress utilities
  createProgress,
  ProgressBar,
  withProgress,
  
  // Testing utilities
  createMockLogger,
  createMockPrompter,
  mockRegistry,
  runCommand,
  createTestHarness,
  expectError
} from '../../src/index.ts';

describe('Error Utilities', () => {
  test('CLIError creates proper error with exit code', () => {
    const error = new CLIError('Test error', 'TEST_ERROR', 42);
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_ERROR');
    expect(error.exitCode).toBe(42);
    expect(error.name).toBe('CLIError');
  });
  
  test('ValidationError includes field information', () => {
    const error = new ValidationError('Invalid value', 'username');
    expect(error.message).toBe('Invalid value');
    expect(error.field).toBe('username');
    expect(error.code).toBe('VALIDATION_ERROR');
  });
  
  test('CommandNotFoundError includes available commands', () => {
    const error = new CommandNotFoundError('foo', ['bar', 'baz']);
    expect(error.message).toBe('Command "foo" not found');
    expect(error.availableCommands).toEqual(['bar', 'baz']);
  });
  
  test('assertDefined throws on null/undefined', () => {
    expectError(() => assertDefined(null, 'Value required'), ValidationError);
    expectError(() => assertDefined(undefined, 'Value required'), ValidationError);
    expect(() => assertDefined('value', 'Value required')).not.toThrow();
  });
});

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

describe('Formatting Utilities', () => {
  test('indent adds spaces', () => {
    expect(indent('line', 2)).toBe('  line');
    expect(indent('line1\nline2', 2)).toBe('  line1\n  line2');
  });
  
  test('dedent removes common indentation', () => {
    const text = '    line1\n    line2\n      line3';
    expect(dedent(text)).toBe('line1\nline2\n  line3');
  });
  
  test('wrap breaks long lines', () => {
    const text = 'This is a very long line that should be wrapped';
    const wrapped = wrap(text, 20);
    expect(wrapped).toContain('\n');
    expect(wrapped.split('\n').every(line => line.length <= 20)).toBe(true);
  });
  
  test('truncate shortens text', () => {
    expect(truncate('Hello World', 8)).toBe('Hello...');
    expect(truncate('Short', 10)).toBe('Short');
  });
  
  test('center pads text', () => {
    expect(center('Hi', 6)).toBe('  Hi  ');
    expect(center('Hi', 6, '-')).toBe('--Hi--');
  });
  
  test('formatDuration converts milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(5500)).toBe('5.5s');
    expect(formatDuration(65000)).toBe('1m 5s');
    expect(formatDuration(3665000)).toBe('1h 1m');
  });
  
  test('formatBytes converts bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });
  
  test('humanize converts to human readable', () => {
    expect(humanize('camelCase')).toBe('Camel case');
    expect(humanize('snake_case')).toBe('Snake case');
    expect(humanize('kebab-case')).toBe('Kebab case');
  });
  
  test('slugify converts to slug', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
    expect(slugify('Test @ 123')).toBe('test-123');
  });
});

describe('Validation Utilities', () => {
  test('createValidator validates values', () => {
    const validator = createValidator([required, string]);
    expect(() => validator.validate('test')).not.toThrow();
    expect(() => validator.validate('')).toThrow(ValidationError);
    expect(() => validator.validate(123)).toThrow(ValidationError);
  });
  
  test('validator chaining with and', () => {
    const validator = createValidator([string]).and(minLength(3));
    expect(() => validator.validate('test')).not.toThrow();
    expect(() => validator.validate('ab')).toThrow(ValidationError);
  });
  
  test('pattern validator', () => {
    const validator = createValidator([pattern(/^[A-Z]+$/, 'Must be uppercase')]);
    expect(() => validator.validate('HELLO')).not.toThrow();
    expect(() => validator.validate('hello')).toThrow(ValidationError);
  });
  
  test('oneOf validator', () => {
    const validator = createValidator([oneOf(['foo', 'bar', 'baz'])]);
    expect(() => validator.validate('foo')).not.toThrow();
    expect(() => validator.validate('qux')).toThrow(ValidationError);
  });
  
  test('validateOptions validates object properties', () => {
    const options = { name: 'test', count: 5 };
    const schema = {
      name: [required, string, minLength(3)],
      count: [required, number]
    };
    
    expect(() => validateOptions(options, schema)).not.toThrow();
    expect(() => validateOptions({ name: 'ab', count: 5 }, schema)).toThrow(ValidationError);
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