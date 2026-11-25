type Schema<T> = {
  readonly json: object;
  parse(value: unknown, path?: string): T;
};

export type Validated<S> = S extends Schema<infer T> ? T : never;

export class SchemaError extends Error {}

function schema<T>(json: object, parse: (value: unknown, path: string) => T): Schema<T> {
  return {json, parse: (value, path = '$') => parse(value, path)};
}

function invalid(path: string, expectation: string): never {
  throw new SchemaError(`${path}: ${expectation}`);
}

export function string(max = 3000, min = 1, pattern?: RegExp): Schema<string> {
  return schema({type: 'string', maxLength: max, minLength: min, ...(pattern && {pattern: pattern.source})},
    (value, path) => {
      if (typeof value !== 'string' || value.length > max || value.trim().length < min ||
          (pattern && !pattern.test(value))) {
        return invalid(path, 'invalid text length or format');
      }
      return value.trim();
    });
}

export function integer(min: number, max: number): Schema<number> {
  return schema({type: 'integer', minimum: min, maximum: max}, (value, path) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      return invalid(path, `expected an integer between ${min} and ${max}`);
    }
    return value;
  });
}

export function choice<const T extends readonly string[]>(...values: T): Schema<T[number]> {
  return schema({enum: values}, (value, path) => {
    if (typeof value !== 'string' || !values.includes(value)) return invalid(path, `expected ${values.join(' | ')}`);
    return value;
  });
}

export const boolean = schema({type: 'boolean'}, (value, path) => {
  if (typeof value !== 'boolean') return invalid(path, 'expected boolean');
  return value;
});

export function array<T>(item: Schema<T>, min = 0, max = 24): Schema<T[]> {
  return schema({type: 'array', items: item.json, minItems: min, maxItems: max}, (value, path) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) {
      return invalid(path, `expected ${min} to ${max} items`);
    }
    return value.map((entry, i) => item.parse(entry, `${path}[${i}]`));
  });
}

export function object<T extends Record<string, Schema<unknown>>>(shape: T): Schema<{[K in keyof T]: Validated<T[K]>}> {
  const fields = Object.entries(shape);
  return schema({
    type: 'object', additionalProperties: false, required: Object.keys(shape),
    properties: Object.fromEntries(fields.map(([key, field]) => [key, field.json])),
  }, (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(path, 'expected object');
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some(key => !Object.hasOwn(shape, key))) return invalid(path, 'unexpected property');
    return Object.fromEntries(fields.map(([key, field]) =>
      [key, field.parse(record[key], `${path}.${key}`)])) as {[K in keyof T]: Validated<T[K]>};
  });
}

export const identifier = string(80, 1, /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
