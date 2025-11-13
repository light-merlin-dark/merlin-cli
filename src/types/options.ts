export interface ParsedOptions {
  _: string[]; // Positional arguments
  [key: string]: any; // Named options
}

export interface OptionParseConfig {
  boolean?: string[];
  string?: string[];
  alias?: Record<string, string>;
  default?: Record<string, any>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}