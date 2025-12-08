/**
 * Argument Extractors
 *
 * Type-safe argument extraction utilities for tool calls.
 * Provides validated extraction of string, number, and array arguments.
 */

/**
 * Safely extract a string argument with validation
 */
export function getStringArg(args: Record<string, unknown>, key: string, required: true): string;
export function getStringArg(
  args: Record<string, unknown>,
  key: string,
  required?: false
): string | undefined;
export function getStringArg(
  args: Record<string, unknown>,
  key: string,
  required = false
): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`Required argument '${key}' is missing`);
    }
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TypeError(`Argument '${key}' must be a string, got ${typeof value}`);
  }
  return value;
}

/**
 * Safely extract a number argument with validation
 */
export function getNumberArg(args: Record<string, unknown>, key: string, required: true): number;
export function getNumberArg(
  args: Record<string, unknown>,
  key: string,
  required?: false
): number | undefined;
export function getNumberArg(
  args: Record<string, unknown>,
  key: string,
  required = false
): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`Required argument '${key}' is missing`);
    }
    return undefined;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      throw new TypeError(`Argument '${key}' must be a number, got invalid string '${value}'`);
    }
    return parsed;
  }
  if (typeof value !== "number") {
    throw new TypeError(`Argument '${key}' must be a number, got ${typeof value}`);
  }
  return value;
}

/**
 * Safely extract a string array argument with validation
 */
export function getStringArrayArg(
  args: Record<string, unknown>,
  key: string,
  required: true
): string[];
export function getStringArrayArg(
  args: Record<string, unknown>,
  key: string,
  required?: false
): string[] | undefined;
export function getStringArrayArg(
  args: Record<string, unknown>,
  key: string,
  required = false
): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`Required argument '${key}' is missing`);
    }
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`Argument '${key}' must be an array, got ${typeof value}`);
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      throw new TypeError(`Argument '${key}[${i}]' must be a string, got ${typeof value[i]}`);
    }
  }
  return value as string[];
}
