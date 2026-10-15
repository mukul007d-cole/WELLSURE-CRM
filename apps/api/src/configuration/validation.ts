import {
  parseCalculationConfig,
  type CalculationConfig,
  type ReferenceableField,
} from '@falcon/validation';

import { ConfigurationError } from './errors.js';

export const statusOutcomeTypes = ['open', 'closed_won', 'closed_lost'] as const;
export const statusBehaviorTypes = ['default', 'call_later', 'follow_up', 'archived'] as const;
/**
 * `required_on_create` (ADR-0026) is enforced only when a lead is created, and
 * only for the roles in `required_role_ids` (empty = every role).
 */
export const fieldRequirements = ['required', 'optional', 'hidden', 'required_on_create'] as const;
/** Kept in step with `validateValue` in `leads/validation.ts` (OD-020). */
export { supportedFieldTypes } from '../leads/validation.js';
/**
 * ADR-0026 — status colors are palette tokens the web client renders, never
 * raw CSS, so a theme change can't strand a stored value.
 */
export const statusColors = [
  'gray',
  'blue',
  'teal',
  'green',
  'lime',
  'amber',
  'orange',
  'red',
  'pink',
  'purple',
  'indigo',
] as const;
export const fieldAccessLevels = ['VIEW', 'EDIT'] as const;
export const fieldEditModes = ['manual', 'locked', 'calculated', 'system', 'api-only'] as const;
export const fieldSources = ['manual', 'system', 'api', 'import', 'calculated'] as const;

export type StatusOutcomeType = (typeof statusOutcomeTypes)[number];
export type StatusBehaviorType = (typeof statusBehaviorTypes)[number];
export type FieldRequirement = (typeof fieldRequirements)[number];
export type FieldAccessLevel = (typeof fieldAccessLevels)[number];

const keyPattern = /^[a-z][a-z0-9_]{1,62}$/;

export function requireConfigKey(key: string): string {
  if (!keyPattern.test(key)) {
    throw new ConfigurationError('validation_error', 'configuration key must be snake_case');
  }
  return key;
}

export function requireNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ConfigurationError('validation_error', `${label} is required`);
  }
  return trimmed;
}

export function requireOneOf<T extends readonly string[]>(
  value: string,
  allowed: T,
  label: string,
): T[number] {
  if (!allowed.includes(value)) {
    throw new ConfigurationError('validation_error', `${label} is invalid`, { allowed });
  }
  return value;
}

export function requireNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ConfigurationError('validation_error', `${label} must be a non-negative integer`);
  }
  return value;
}

/**
 * Wraps the shared, dependency-free `@falcon/validation` parser: this module
 * throws `ConfigurationError`, same as every other `require*` here, rather
 * than making `@falcon/validation` invent an error type both `configuration`
 * and `leads` would separately have to recognize.
 */
export function requireCalculationConfig(input: {
  raw: unknown;
  fieldType: string;
  ownFieldId: string | null;
  referenceable: ReadonlyMap<string, ReferenceableField>;
}): CalculationConfig {
  const result = parseCalculationConfig(input);
  if (!result.ok) throw new ConfigurationError('validation_error', result.reason);
  return result.config;
}

/**
 * `system` edit mode's config is deliberately just a free-text key today —
 * no catalog of system-populated values has been decided (`leads/validation.ts`'s
 * `computeSystemValue` is a documented no-op) — so this only checks the key
 * is present, not that it names anything real yet.
 */
export function requireSystemKey(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) {
    throw new ConfigurationError(
      'validation_error',
      'system config is required for a system field',
    );
  }
  const key = (raw as { key?: unknown }).key;
  if (typeof key !== 'string' || key.trim() === '') {
    throw new ConfigurationError('validation_error', 'system config requires a non-blank key');
  }
  return key.trim();
}

export function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireFieldValidationRule(fieldType: string, value: unknown): unknown {
  if (fieldType !== 'select' && fieldType !== 'multi_select') return value ?? null;
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { options?: unknown }).options)
  )
    throw new ConfigurationError(
      'validation_error',
      `${fieldType} fields require validationRule.options`,
    );
  const options = (value as { options: unknown[] }).options;
  if (
    options.length === 0 ||
    options.some((option) => typeof option !== 'string' || option.trim() === '') ||
    new Set(options).size !== options.length
  )
    throw new ConfigurationError(
      'validation_error',
      'select field options must be unique non-blank strings',
    );
  return {
    ...(value as Record<string, unknown>),
    options: options.map((option) => String(option).trim()),
  };
}

/** The reason options a status offers: unique, non-blank, at most 50. */
export function requireReasonOptions(value: unknown): string[] {
  if (!Array.isArray(value))
    throw new ConfigurationError('validation_error', 'reasonOptions must be an array');
  const options = value.map((option) => (typeof option === 'string' ? option.trim() : ''));
  if (options.some((option) => option === '' || option.length > 200))
    throw new ConfigurationError('validation_error', 'reason options must be non-blank strings');
  if (new Set(options).size !== options.length)
    throw new ConfigurationError('validation_error', 'reason options must be unique');
  if (options.length > 50)
    throw new ConfigurationError('validation_error', 'a status may offer at most 50 reasons');
  return options;
}

export function requireUniqueIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || id.trim() === ''))
    throw new ConfigurationError('validation_error', `${label} must be an array of ids`);
  const ids = value as string[];
  if (new Set(ids).size !== ids.length)
    throw new ConfigurationError('validation_error', `${label} must be unique`);
  return ids;
}
