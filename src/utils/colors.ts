/**
 * ANSI styling, implemented here rather than taken as a dependency.
 *
 * The surface is the same one 1.x exposed via picocolors. Owning the ~50 lines
 * of escape codes it actually used removes the last runtime dependency and,
 * more usefully, lets colour follow a rule the contract can test: bytes only
 * reach a stream that is a TTY.
 */

/**
 * Whether colour is permitted at all, by environment.
 *
 * `FORCE_COLOR` wins over everything (CI systems that render ANSI use it).
 * `NO_COLOR` and `TERM=dumb` disable it. Otherwise it is per-stream, decided
 * by `supportsColor`.
 */
function envAllowsColor(): boolean | null {
  const env = process.env;

  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true;
  if (env.FORCE_COLOR === '0') return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.TERM === 'dumb') return false;

  return null;
}

/** True when ANSI is safe to write to the given stream. */
export function supportsColor(stream: { isTTY?: boolean } = process.stdout): boolean {
  const forced = envAllowsColor();
  if (forced !== null) return forced;
  return Boolean(stream?.isTTY);
}

const OPEN = '\u001b[';

/**
 * What a colour function accepts.
 *
 * Deliberately wider than `string`: picocolors took anything printable, and
 * `colors.cyan(port)` on a number is a real call site in the estate. Narrowing
 * it would be a type-level break for code that never changed.
 */
export type Colorable = string | number | boolean | null | undefined;
export type Formatter = (text: Colorable) => string;

function style(open: number, close: number): Formatter {
  const openCode = `${OPEN}${open}m`;
  const closeCode = `${OPEN}${close}m`;

  return (text: Colorable): string => {
    if (!supportsColor()) return String(text);
    const value = String(text);
    // Re-open after any nested reset, so `red(a + dim(b) + c)` keeps c red.
    return openCode + (value.includes(closeCode) ? value.replaceAll(closeCode, closeCode + openCode) : value) + closeCode;
  };
}

const black = style(30, 39);
const red = style(31, 39);
const green = style(32, 39);
const yellow = style(33, 39);
const blue = style(34, 39);
const magenta = style(35, 39);
const cyan = style(36, 39);
const white = style(37, 39);
const gray = style(90, 39);

export const colors = {
  // Basic colors
  black,
  red,
  green,
  yellow,
  blue,
  magenta,
  cyan,
  white,
  gray,

  // Bright colors
  brightRed: style(91, 39),
  brightGreen: style(92, 39),
  brightYellow: style(93, 39),
  brightBlue: style(94, 39),
  brightMagenta: style(95, 39),
  brightCyan: style(96, 39),
  brightWhite: style(97, 39),

  // Background colors
  bgRed: style(41, 49),
  bgGreen: style(42, 49),
  bgYellow: style(43, 49),
  bgBlue: style(44, 49),
  bgMagenta: style(45, 49),
  bgCyan: style(46, 49),
  bgWhite: style(47, 49),

  // Styles
  bold: style(1, 22),
  dim: style(2, 22),
  italic: style(3, 23),
  underline: style(4, 24),
  strikethrough: style(9, 29),
  reset: style(0, 0),

  // Semantic colors
  error: red,
  warning: yellow,
  info: blue,
  success: green,
  muted: gray,

  // Common patterns
  command: cyan,
  argument: yellow,
  option: blue,
  value: green,
  path: magenta,
  url: style(4, 24),

  // Composite styles
  header: (text: Colorable) => colors.bold(colors.underline(text)),
  label: (text: Colorable) => colors.bold(text),
  highlight: (text: Colorable) => colors.bgYellow(colors.black(text)),
  code: (text: Colorable) => gray(`${text}`),
};

/**
 * A small palette bound to one stream.
 *
 * The `colors` export above decides by stdout, which is what a command
 * formatting its payload wants. Commentary goes to stderr, and ANSI must not
 * reach a pipe just because the *other* stream happens to be a terminal.
 */
export function createStyler(stream: { isTTY?: boolean }): Record<'red' | 'green' | 'yellow' | 'blue' | 'gray', (text: string) => string> {
  const on = supportsColor(stream);
  const wrap = (open: number) => (text: string): string =>
    on ? `${OPEN}${open}m${text}${OPEN}39m` : text;

  return { red: wrap(31), green: wrap(32), yellow: wrap(33), blue: wrap(34), gray: wrap(90) };
}

export function stripColors(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

export function colorize(text: Colorable, color?: keyof typeof colors): string {
  if (!color || !colors[color]) return String(text);
  return (colors[color] as Formatter)(text);
}

export function gradient(text: string, from: string, to: string): string {
  const chars = String(text).split('');
  const mid = Math.floor(chars.length / 2);

  return chars.map((char, i) => {
    if (i < mid) {
      return colorize(char, from as keyof typeof colors);
    }
    return colorize(char, to as keyof typeof colors);
  }).join('');
}

export function table(data: Record<string, string | number>[], options?: {
  headers?: boolean;
  colors?: boolean;
}): string {
  if (data.length === 0) return '';

  const keys = Object.keys(data[0]);
  const widths = keys.map(key => {
    const values = data.map(row => String(row[key]));
    return Math.max(key.length, ...values.map(v => stripColors(v).length));
  });

  const lines: string[] = [];

  if (options?.headers !== false) {
    const header = keys.map((key, i) => {
      const text = key.padEnd(widths[i]);
      return options?.colors !== false ? colors.bold(text) : text;
    }).join('  ');
    lines.push(header);

    const separator = widths.map(w => '-'.repeat(w)).join('  ');
    lines.push(options?.colors !== false ? colors.dim(separator) : separator);
  }

  data.forEach(row => {
    const line = keys.map((key, i) => {
      return String(row[key]).padEnd(widths[i]);
    }).join('  ');
    lines.push(line);
  });

  return lines.join('\n');
}

export function box(content: string, options?: {
  padding?: number;
  margin?: number;
  borderStyle?: 'single' | 'double' | 'round' | 'bold';
  borderColor?: keyof typeof colors;
  title?: string;
}): string {
  const padding = options?.padding ?? 1;
  const margin = options?.margin ?? 0;
  const marginStr = ' '.repeat(margin);

  const borders = {
    single: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
    double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
    round: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
    bold: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
  };

  const border = borders[options?.borderStyle || 'single'];
  const lines = content.split('\n');
  const maxLength = Math.max(...lines.map(l => stripColors(l).length));
  const innerWidth = maxLength + (padding * 2);

  const color = (options?.borderColor ? colors[options.borderColor] : (x: Colorable) => String(x)) as Formatter;

  const result: string[] = [];

  let topBorder = border.tl + border.h.repeat(innerWidth) + border.tr;
  if (options?.title) {
    const titleLength = stripColors(options.title).length;
    const leftPadding = Math.max(0, Math.floor((innerWidth - titleLength - 2) / 2));
    const rightPadding = Math.max(0, innerWidth - titleLength - 2 - leftPadding);
    topBorder = border.tl + border.h.repeat(leftPadding) + ' ' + options.title + ' ' + border.h.repeat(rightPadding) + border.tr;
  }
  result.push(marginStr + color(topBorder));

  for (let i = 0; i < padding; i++) {
    result.push(marginStr + color(border.v) + ' '.repeat(innerWidth) + color(border.v));
  }

  lines.forEach(line => {
    const lineLength = stripColors(line).length;
    const totalPadding = innerWidth - lineLength;
    const leftPad = Math.floor(totalPadding / 2);
    const rightPad = totalPadding - leftPad;

    result.push(
      marginStr +
      color(border.v) +
      ' '.repeat(leftPad) +
      line +
      ' '.repeat(rightPad) +
      color(border.v)
    );
  });

  for (let i = 0; i < padding; i++) {
    result.push(marginStr + color(border.v) + ' '.repeat(innerWidth) + color(border.v));
  }

  result.push(marginStr + color(border.bl) + border.h.repeat(innerWidth) + color(border.br));

  return result.join('\n');
}

export function badge(text: string, options?: {
  color?: keyof typeof colors;
  bgColor?: keyof typeof colors;
}): string {
  let result = ` ${text} `;

  if (options?.bgColor && colors[options.bgColor]) {
    result = (colors[options.bgColor] as Formatter)(result);
  }

  if (options?.color && colors[options.color]) {
    result = (colors[options.color] as Formatter)(result);
  }

  return result;
}
