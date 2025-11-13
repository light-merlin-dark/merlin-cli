import pc from 'picocolors';

export const colors = {
  // Basic colors
  black: pc.black,
  red: pc.red,
  green: pc.green,
  yellow: pc.yellow,
  blue: pc.blue,
  magenta: pc.magenta,
  cyan: pc.cyan,
  white: pc.white,
  gray: pc.gray,
  
  // Bright colors
  brightRed: pc.redBright,
  brightGreen: pc.greenBright,
  brightYellow: pc.yellowBright,
  brightBlue: pc.blueBright,
  brightMagenta: pc.magentaBright,
  brightCyan: pc.cyanBright,
  brightWhite: pc.whiteBright,
  
  // Background colors
  bgRed: pc.bgRed,
  bgGreen: pc.bgGreen,
  bgYellow: pc.bgYellow,
  bgBlue: pc.bgBlue,
  bgMagenta: pc.bgMagenta,
  bgCyan: pc.bgCyan,
  bgWhite: pc.bgWhite,
  
  // Styles
  bold: pc.bold,
  dim: pc.dim,
  italic: pc.italic,
  underline: pc.underline,
  strikethrough: pc.strikethrough,
  reset: pc.reset,
  
  // Semantic colors
  error: pc.red,
  warning: pc.yellow,
  info: pc.blue,
  success: pc.green,
  muted: pc.gray,
  
  // Common patterns
  command: pc.cyan,
  argument: pc.yellow,
  option: pc.blue,
  value: pc.green,
  path: pc.magenta,
  url: pc.underline,
  
  // Composite styles
  header: (text: string) => pc.bold(pc.underline(text)),
  label: (text: string) => pc.bold(text),
  highlight: (text: string) => pc.bgYellow(pc.black(text)),
  code: (text: string) => pc.gray(`${text}`),
};

export function stripColors(text: string): string {
  // Remove ANSI color codes
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

export function colorize(text: string, color?: keyof typeof colors): string {
  if (!color || !colors[color]) return text;
  return (colors[color] as (text: string) => string)(text);
}

export function gradient(text: string, from: string, to: string): string {
  // Simple two-color gradient effect
  const chars = text.split('');
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
  
  // Header
  if (options?.headers !== false) {
    const header = keys.map((key, i) => {
      const text = key.padEnd(widths[i]);
      return options?.colors !== false ? colors.bold(text) : text;
    }).join('  ');
    lines.push(header);
    
    // Separator
    const separator = widths.map(w => '-'.repeat(w)).join('  ');
    lines.push(options?.colors !== false ? colors.dim(separator) : separator);
  }
  
  // Rows
  data.forEach(row => {
    const line = keys.map((key, i) => {
      return String(row[key]).padEnd(widths[i]);
    }).join('  ');
    lines.push(line);
  });
  
  return lines.join('\\n');
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
  const lines = content.split('\\n');
  const maxLength = Math.max(...lines.map(l => stripColors(l).length));
  const innerWidth = maxLength + (padding * 2);
  
  const color = options?.borderColor ? colors[options.borderColor] : (x: string) => x;
  
  const result: string[] = [];
  
  // Top border with optional title
  let topBorder = border.tl + border.h.repeat(innerWidth) + border.tr;
  if (options?.title) {
    const titleLength = stripColors(options.title).length;
    const leftPadding = Math.floor((innerWidth - titleLength - 2) / 2);
    const rightPadding = innerWidth - titleLength - 2 - leftPadding;
    topBorder = border.tl + border.h.repeat(leftPadding) + ' ' + options.title + ' ' + border.h.repeat(rightPadding) + border.tr;
  }
  result.push(marginStr + color(topBorder));
  
  // Padding top
  for (let i = 0; i < padding; i++) {
    result.push(marginStr + color(border.v) + ' '.repeat(innerWidth) + color(border.v));
  }
  
  // Content lines
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
  
  // Padding bottom
  for (let i = 0; i < padding; i++) {
    result.push(marginStr + color(border.v) + ' '.repeat(innerWidth) + color(border.v));
  }
  
  // Bottom border
  result.push(marginStr + color(border.bl) + border.h.repeat(innerWidth) + color(border.br));
  
  return result.join('\\n');
}

export function badge(text: string, options?: {
  color?: keyof typeof colors;
  bgColor?: keyof typeof colors;
}): string {
  let result = ` ${text} `;
  
  if (options?.bgColor && colors[options.bgColor]) {
    result = (colors[options.bgColor] as (text: string) => string)(result);
  }
  
  if (options?.color && colors[options.color]) {
    result = (colors[options.color] as (text: string) => string)(result);
  }
  
  return result;
}