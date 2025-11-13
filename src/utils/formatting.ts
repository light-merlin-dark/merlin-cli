import { colors } from './colors.ts';

export function indent(text: string, spaces: number = 2): string {
  const indentation = ' '.repeat(spaces);
  return text.split('\n').map(line => indentation + line).join('\n');
}

export function dedent(text: string): string {
  const lines = text.split('\n');
  const minIndent = lines
    .filter(line => line.trim().length > 0)
    .reduce((min, line) => {
      const match = line.match(/^(\s*)/);
      return Math.min(min, match ? match[1].length : 0);
    }, Infinity);
  
  return lines
    .map(line => line.slice(minIndent))
    .join('\n')
    .trim();
}

export function wrap(text: string, width: number = 80, indent: number = 0): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';
  const indentStr = ' '.repeat(indent);
  
  words.forEach(word => {
    if (currentLine.length + word.length + 1 <= width - indent) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(indentStr + currentLine);
      currentLine = word;
    }
  });
  
  if (currentLine) lines.push(indentStr + currentLine);
  return lines.join('\n');
}

export function truncate(text: string, maxLength: number, suffix: string = '...'): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - suffix.length) + suffix;
}

export function center(text: string, width: number, fillChar: string = ' '): string {
  const textLength = text.length;
  if (textLength >= width) return text;
  
  const totalPadding = width - textLength;
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  
  return fillChar.repeat(leftPadding) + text + fillChar.repeat(rightPadding);
}

export function padStart(text: string, length: number, fillChar: string = ' '): string {
  const textLength = text.length;
  if (textLength >= length) return text;
  return fillChar.repeat(length - textLength) + text;
}

export function padEnd(text: string, length: number, fillChar: string = ' '): string {
  const textLength = text.length;
  if (textLength >= length) return text;
  return text + fillChar.repeat(length - textLength);
}

export function list(items: string[], options?: {
  ordered?: boolean;
  indent?: number;
  marker?: string;
}): string {
  const indent = ' '.repeat(options?.indent || 0);
  
  return items.map((item, index) => {
    const marker = options?.ordered 
      ? `${index + 1}.`
      : (options?.marker || '-');
    return `${indent}${marker} ${item}`;
  }).join('\n');
}

export function columns(data: string[][], options?: {
  separator?: string;
  headers?: string[];
}): string {
  const separator = options?.separator || '  ';
  const allRows = options?.headers ? [options.headers, ...data] : data;
  
  // Calculate column widths
  const widths = allRows[0].map((_, colIndex) => {
    return Math.max(...allRows.map(row => (row[colIndex] || '').length));
  });
  
  // Format rows
  const formattedRows = allRows.map((row, rowIndex) => {
    return row.map((cell, colIndex) => {
      return padEnd(cell || '', widths[colIndex]);
    }).join(separator);
  });
  
  // Add header separator if headers provided
  if (options?.headers) {
    const separatorLine = widths.map(w => '-'.repeat(w)).join(separator);
    formattedRows.splice(1, 0, separatorLine);
  }
  
  return formattedRows.join('\n');
}

export function tree(node: TreeNode, options?: {
  prefix?: string;
  isLast?: boolean;
  showHidden?: boolean;
}): string {
  const prefix = options?.prefix || '';
  const isLast = options?.isLast ?? true;
  const lines: string[] = [];
  
  // Current node
  const connector = isLast ? '└── ' : '├── ';
  lines.push(prefix + connector + node.name);
  
  // Children
  if (node.children) {
    const children = options?.showHidden 
      ? node.children 
      : node.children.filter(c => !c.name.startsWith('.'));
    
    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    
    children.forEach((child, index) => {
      const isLastChild = index === children.length - 1;
      lines.push(tree(child, {
        prefix: childPrefix,
        isLast: isLastChild,
        showHidden: options?.showHidden
      }));
    });
  }
  
  return lines.join('\n');
}

export interface TreeNode {
  name: string;
  children?: TreeNode[];
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatNumber(num: number, options?: {
  decimals?: number;
  thousandsSeparator?: string;
}): string {
  const decimals = options?.decimals ?? 0;
  const separator = options?.thousandsSeparator ?? ',';
  
  const parts = num.toFixed(decimals).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  
  return parts.join('.');
}

export function formatPercent(value: number, options?: {
  decimals?: number;
  total?: number;
}): string {
  const percent = options?.total 
    ? (value / options.total) * 100
    : value * 100;
    
  return `${percent.toFixed(options?.decimals ?? 1)}%`;
}

export function formatDate(date: Date, format: string = 'YYYY-MM-DD HH:mm:ss'): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  
  const replacements: Record<string, string> = {
    'YYYY': date.getFullYear().toString(),
    'YY': date.getFullYear().toString().slice(-2),
    'MM': pad(date.getMonth() + 1),
    'DD': pad(date.getDate()),
    'HH': pad(date.getHours()),
    'mm': pad(date.getMinutes()),
    'ss': pad(date.getSeconds()),
    'SSS': date.getMilliseconds().toString().padStart(3, '0'),
  };
  
  let result = format;
  Object.entries(replacements).forEach(([key, value]) => {
    result = result.replace(new RegExp(key, 'g'), value);
  });
  
  return result;
}

export function humanize(text: string): string {
  return text
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^\w/, c => c.toUpperCase());
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export function highlight(text: string, pattern: string | RegExp, style?: keyof typeof colors): string {
  const regex = typeof pattern === 'string' 
    ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    : pattern;
    
  return text.replace(regex, match => {
    return style && colors[style] 
      ? (colors[style] as (text: string) => string)(match)
      : colors.highlight(match);
  });
}