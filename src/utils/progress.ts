import { colors } from './colors.ts';

export interface Progress {
  start(message: string): void;
  update(message: string): void;
  succeed(message?: string): void;
  fail(message?: string): void;
  stop(): void;
}

export interface SpinnerOptions {
  spinner?: string[];
  interval?: number;
  stream?: NodeJS.WriteStream;
  color?: keyof typeof colors;
}

const spinners = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  dots2: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
  line: ['－', '\\', '|', '/'],
  circle: ['◐', '◓', '◑', '◒'],
  square: ['◰', '◳', '◲', '◱'],
  arrow: ['←', '↑', '→', '↓'],
  bounce: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
  bar: ['▁', '▃', '▄', '▅', '▆', '▇', '█', '▇', '▆', '▅', '▄', '▃'],
  clock: ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛'],
};

class Spinner implements Progress {
  private frames: string[];
  private interval: number;
  private stream: NodeJS.WriteStream;
  private color?: keyof typeof colors;
  private timer?: NodeJS.Timeout;
  private currentFrame: number = 0;
  private message: string = '';
  private isSpinning: boolean = false;

  constructor(options?: SpinnerOptions) {
    this.frames = options?.spinner || spinners.dots;
    this.interval = options?.interval || 80;
    this.stream = options?.stream || process.stderr;
    this.color = options?.color;
  }

  start(message: string): void {
    if (this.isSpinning) return;
    
    this.message = message;
    this.isSpinning = true;
    this.currentFrame = 0;
    
    this.render();
    this.timer = setInterval(() => this.render(), this.interval);
  }

  update(message: string): void {
    this.message = message;
    if (this.isSpinning) {
      this.clear();
      this.render();
    }
  }

  succeed(message?: string): void {
    this.stop();
    const finalMessage = message || this.message;
    this.stream.write(`${colors.success('✓')} ${finalMessage}\n`);
  }

  fail(message?: string): void {
    this.stop();
    const finalMessage = message || this.message;
    this.stream.write(`${colors.error('✗')} ${finalMessage}\n`);
  }

  stop(): void {
    if (!this.isSpinning) return;
    
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    
    this.clear();
    this.isSpinning = false;
  }

  private render(): void {
    const frame = this.frames[this.currentFrame];
    const coloredFrame = this.color ? colors[this.color](frame) : frame;
    
    this.stream.write(`\r${coloredFrame} ${this.message}`);
    this.currentFrame = (this.currentFrame + 1) % this.frames.length;
  }

  private clear(): void {
    this.stream.write('\r\x1b[K');
  }
}

export function createProgress(options?: SpinnerOptions): Progress {
  // Check if we're in a CI environment or output is not a TTY
  if (process.env.CI || !process.stderr.isTTY) {
    // Return a simple non-animated progress indicator
    return {
      start(message: string): void {
        process.stderr.write(`⏳ ${message}\n`);
      },
      update(message: string): void {
        process.stderr.write(`⏳ ${message}\n`);
      },
      succeed(message?: string): void {
        if (message) process.stderr.write(`✓ ${message}\n`);
      },
      fail(message?: string): void {
        if (message) process.stderr.write(`✗ ${message}\n`);
      },
      stop(): void {
        // No-op for CI
      }
    };
  }
  
  return new Spinner(options);
}

export interface ProgressBarOptions {
  total: number;
  width?: number;
  format?: string;
  complete?: string;
  incomplete?: string;
  head?: string;
  clear?: boolean;
  stream?: NodeJS.WriteStream;
}

export class ProgressBar {
  private total: number;
  private width: number;
  private format: string;
  private completeChar: string;
  private incomplete: string;
  private head: string;
  private clear: boolean;
  private stream: NodeJS.WriteStream;
  private current: number = 0;
  private startTime: number = Date.now();
  private lastRender: number = 0;

  constructor(options: ProgressBarOptions) {
    this.total = options.total;
    this.width = options.width || 40;
    this.format = options.format || ':bar :percent :current/:total :elapsed';
    this.completeChar = options.complete || '█';
    this.incomplete = options.incomplete || '░';
    this.head = options.head || '';
    this.clear = options.clear ?? false;
    this.stream = options.stream || process.stderr;
  }

  update(current: number, tokens?: Record<string, string>): void {
    this.current = Math.min(current, this.total);
    
    // Throttle renders to max 10 per second
    const now = Date.now();
    if (now - this.lastRender < 100 && this.current < this.total) return;
    this.lastRender = now;
    
    this.render(tokens);
  }

  increment(delta: number = 1, tokens?: Record<string, string>): void {
    this.update(this.current + delta, tokens);
  }

  complete(): void {
    this.update(this.total);
    if (this.clear) {
      this.stream.write('\r\x1b[K');
    } else {
      this.stream.write('\n');
    }
  }

  private render(tokens?: Record<string, string>): void {
    const percent = this.current / this.total;
    const filled = Math.floor(this.width * percent);
    const empty = this.width - filled;
    
    let bar = this.completeChar.repeat(filled);
    if (filled < this.width) {
      bar += this.head || this.incomplete;
      bar += this.incomplete.repeat(Math.max(0, empty - 1));
    }
    
    const elapsed = Date.now() - this.startTime;
    const eta = percent > 0 ? (elapsed / percent) - elapsed : 0;
    
    const defaultTokens = {
      bar,
      percent: `${Math.floor(percent * 100)}%`,
      current: String(this.current),
      total: String(this.total),
      elapsed: formatTime(elapsed),
      eta: formatTime(eta),
      rate: String(Math.round(this.current / (elapsed / 1000))),
      ...tokens
    };
    
    let output = this.format;
    Object.entries(defaultTokens).forEach(([key, value]) => {
      output = output.replace(`:${key}`, value);
    });
    
    this.stream.write(`\r${output}`);
  }
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

export function withProgress<T>(
  task: () => Promise<T>,
  message: string,
  options?: SpinnerOptions
): Promise<T> {
  const progress = createProgress(options);
  progress.start(message);
  
  return task()
    .then(result => {
      progress.succeed();
      return result;
    })
    .catch(error => {
      progress.fail();
      throw error;
    });
}

export async function withProgressBar<T>(
  items: T[],
  handler: (item: T, index: number) => Promise<void>,
  options?: Partial<ProgressBarOptions> & { label?: string }
): Promise<void> {
  const bar = new ProgressBar({
    total: items.length,
    format: options?.label 
      ? `${options.label} [:bar] :percent :current/:total :elapsed`
      : '[:bar] :percent :current/:total :elapsed',
    ...options
  });
  
  for (let i = 0; i < items.length; i++) {
    await handler(items[i], i);
    bar.increment();
  }
  
  bar.complete();
}

// Export spinner types for convenience
export const spinnerTypes = Object.keys(spinners) as (keyof typeof spinners)[];

export function createMultiProgress(): {
  add(label: string): Progress;
  remove(label: string): void;
  clear(): void;
} {
  const progresses = new Map<string, { progress: Progress; line: number }>();
  let nextLine = 0;
  
  return {
    add(label: string): Progress {
      const line = nextLine++;
      const progress = createProgress();
      progresses.set(label, { progress, line });
      
      // Move cursor to the right line
      process.stderr.write(`\n`.repeat(line + 1));
      process.stderr.write(`\x1b[${line + 1}A`);
      
      return progress;
    },
    
    remove(label: string): void {
      const item = progresses.get(label);
      if (item) {
        item.progress.stop();
        progresses.delete(label);
      }
    },
    
    clear(): void {
      progresses.forEach(item => item.progress.stop());
      progresses.clear();
      process.stderr.write(`\x1b[${nextLine}B`);
      nextLine = 0;
    }
  };
}