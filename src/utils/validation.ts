import { ValidationError } from './errors.ts';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import * as v from 'valibot';

// Re-export common Valibot types and functions for convenience
export {
  string,
  number,
  boolean,
  array,
  object,
  optional,
  nullable,
  union,
  literal,
  picklist,
  minLength,
  maxLength,
  minValue,
  maxValue,
  email,
  url,
  regex,
  custom,
  pipe,
  type BaseSchema,
  type BaseIssue,
  type InferOutput,
  type InferInput,
} from 'valibot';

// Create a wrapper for Valibot schemas to throw ValidationError
export function validate<T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: T,
  value: unknown,
  field?: string
): v.InferOutput<T> {
  const result = v.safeParse(schema, value);

  if (!result.success) {
    const firstIssue = result.issues[0];
    const message = firstIssue?.message || 'Validation failed';
    throw new ValidationError(message, field);
  }

  return result.output;
}

// Legacy API compatibility - ValidationRule interface
export interface ValidationRule<T = any> {
  validate: (value: T) => boolean | string;
  message?: string;
}

export interface Validator<T = any> {
  validate(value: T): void;
  and(rule: ValidationRule<T>): Validator<T>;
  or(validator: Validator<T>): Validator<T>;
}

export function createValidator<T>(rules: ValidationRule<T>[]): Validator<T> {
  const validator: Validator<T> = {
    validate(value: T): void {
      for (const rule of rules) {
        const result = rule.validate(value);
        if (result === false || typeof result === 'string') {
          throw new ValidationError(
            typeof result === 'string' ? result : rule.message || 'Validation failed'
          );
        }
      }
    },

    and(rule: ValidationRule<T>): Validator<T> {
      return createValidator([...rules, rule]);
    },

    or(otherValidator: Validator<T>): Validator<T> {
      return createValidator([{
        validate: (value: T) => {
          try {
            validator.validate(value);
            return true;
          } catch {
            try {
              otherValidator.validate(value);
              return true;
            } catch {
              return false;
            }
          }
        },
        message: 'None of the validation rules passed'
      }]);
    }
  };

  return validator;
}

// Common validation rules (legacy API)
export const required: ValidationRule = {
  validate: (value: any) => value !== null && value !== undefined && value !== '',
  message: 'Value is required'
};

// Valibot-based validators
export const requiredString = v.pipe(v.string(), v.minLength(1, 'Value is required'));
export const requiredNumber = v.number('Value must be a number');
export const requiredBoolean = v.boolean('Value must be a boolean');

// Pattern validator
export function pattern(regex: RegExp, message?: string): ValidationRule<string> {
  return {
    validate: (value) => regex.test(value),
    message: message || `Value must match pattern ${regex}`
  };
}

// OneOf validator
export function oneOf<T>(values: T[], message?: string): ValidationRule<T> {
  return {
    validate: (value) => values.includes(value),
    message: message || `Value must be one of: ${values.join(', ')}`
  };
}

// File system validators using Valibot custom
export const fileExists = v.pipe(
  v.string(),
  v.custom((value) => existsSync(value as string), 'File does not exist')
);

export const dirExists = v.pipe(
  v.string(),
  v.custom(
    (value) => existsSync(value as string) && statSync(value as string).isDirectory(),
    'Directory does not exist'
  )
);

export const isFile = v.pipe(
  v.string(),
  v.custom(
    (value) => existsSync(value as string) && statSync(value as string).isFile(),
    'Path is not a file'
  )
);

export const isDirectory = v.pipe(
  v.string(),
  v.custom(
    (value) => existsSync(value as string) && statSync(value as string).isDirectory(),
    'Path is not a directory'
  )
);

export const absolutePath = v.pipe(
  v.string(),
  v.custom((value) => isAbsolute(value as string), 'Path must be absolute')
);

// Network validators
export const ipAddress = v.pipe(
  v.string(),
  v.custom((value) => {
    const val = value as string;
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6 = /^([\da-f]{1,4}:){7}[\da-f]{1,4}$/i;
    return ipv4.test(val) || ipv6.test(val);
  }, 'Value must be a valid IP address')
);

export const port = v.pipe(
  v.number(),
  v.integer('Port must be an integer'),
  v.minValue(1, 'Port must be at least 1'),
  v.maxValue(65535, 'Port must be at most 65535')
);

// Date validators
export const date = v.pipe(
  v.string(),
  v.custom((value) => !isNaN(Date.parse(value as string)), 'Value must be a valid date')
);

export function after(dateValue: Date | string) {
  const compareDate = new Date(dateValue);
  return v.pipe(
    v.string(),
    v.custom(
      (value) => new Date(value as string) > compareDate,
      `Date must be after ${compareDate.toISOString()}`
    )
  );
}

export function before(dateValue: Date | string) {
  const compareDate = new Date(dateValue);
  return v.pipe(
    v.string(),
    v.custom(
      (value) => new Date(value as string) < compareDate,
      `Date must be before ${compareDate.toISOString()}`
    )
  );
}

// Composite validators
export function validateOptions<T extends Record<string, any>>(
  options: T,
  schema: Record<keyof T, ValidationRule | ValidationRule[] | v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>
): void {
  for (const [key, rules] of Object.entries(schema) as [keyof T, any][]) {
    // Check if it's a Valibot schema
    if (rules && typeof rules === 'object' && '_run' in rules) {
      // It's a Valibot schema
      try {
        validate(rules, options[key], String(key));
      } catch (error) {
        throw error;
      }
    } else {
      // Legacy validation rules
      const rulesArray = Array.isArray(rules) ? rules : [rules];
      const validator = createValidator(rulesArray);

      try {
        validator.validate(options[key]);
      } catch (error) {
        if (error instanceof ValidationError) {
          throw new ValidationError(error.message, String(key));
        }
        throw error;
      }
    }
  }
}

// Type guards
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isArray<T = any>(value: unknown): value is T[] {
  return Array.isArray(value);
}

export function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFunction(value: unknown): value is Function {
  return typeof value === 'function';
}

export function isPromise<T = any>(value: unknown): value is Promise<T> {
  return value instanceof Promise || (
    isObject(value) &&
    isFunction((value as any).then) &&
    isFunction((value as any).catch)
  );
}

// Sanitizers
export function sanitize(value: string, options?: {
  trim?: boolean;
  lowercase?: boolean;
  uppercase?: boolean;
  removeSpaces?: boolean;
  alphanumeric?: boolean;
}): string {
  let result = value;

  if (options?.trim !== false) result = result.trim();
  if (options?.lowercase) result = result.toLowerCase();
  if (options?.uppercase) result = result.toUpperCase();
  if (options?.removeSpaces) result = result.replace(/\s+/g, '');
  if (options?.alphanumeric) result = result.replace(/[^a-zA-Z0-9]/g, '');

  return result;
}

export function coerce<T>(value: any, type: 'string' | 'number' | 'boolean' | 'array'): T {
  switch (type) {
    case 'string':
      return String(value) as T;
    case 'number':
      const num = Number(value);
      if (isNaN(num)) throw new ValidationError(`Cannot coerce "${value}" to number`);
      return num as T;
    case 'boolean':
      if (value === 'true' || value === '1' || value === 1) return true as T;
      if (value === 'false' || value === '0' || value === 0) return false as T;
      return Boolean(value) as T;
    case 'array':
      if (isArray(value)) return value as T;
      if (isString(value)) return value.split(',').map(s => s.trim()) as T;
      return [value] as T;
    default:
      throw new ValidationError(`Unknown coercion type: ${type}`);
  }
}
