import { ConfigurationError } from './errors.js';

export const statusOutcomeTypes = ['open', 'closed_won', 'closed_lost'] as const;
export const statusBehaviorTypes = ['default', 'call_later', 'follow_up', 'archived'] as const;
export const fieldRequirements = ['required', 'optional', 'hidden'] as const;
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
