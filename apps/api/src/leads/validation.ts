import {
  computeCalculatedValue,
  isCalculationConfig,
  type CalculationConfig,
} from '@falcon/validation';

import { LeadError } from './errors.js';

export interface LeadFieldDefinition {
  id: string;
  fieldType: string;
  validationRule: unknown;
  editMode: string;
  active: boolean;
}

export interface LeadFieldSetting {
  fieldId: string;
  journeyId: string;
  requirement: string;
  requiredFromStatusId: string | null;
  active: boolean;
  field: LeadFieldDefinition;
}

export function validateNonBlank(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0) throw new LeadError('validation_error', `${label} is required`);
  return trimmed;
}

export function validateAssignments(
  assignments: readonly { assignmentType: string; userId: string }[],
): readonly { assignmentType: string; userId: string }[] {
  if (assignments.length === 0) {
    throw new LeadError('validation_error', 'at least one assignment is required');
  }
  for (const assignment of assignments) {
    validateNonBlank(assignment.assignmentType, 'assignment_type');
    validateNonBlank(assignment.userId, 'assignment user');
  }
  return assignments;
}

/**
 * Every write to `Lead.field_values` — `createLead`, `editLead`,
 * `createLead`'s `existingLeadId` merge branch, and bulk import (which calls
 * `createLead` too, per row) — funnels through this one function. That's
 * deliberate: it's the single place a Field's `editMode` gets enforced, so
 * every one of those paths honors it identically without each having to know
 * about it.
 *
 * - `manual` / `api-only`: the client's value is accepted as given. The two
 *   only differ in the human-facing form, which never renders an editable
 *   control for `api-only` — there is no second caller identity here to gate
 *   on server-side (one session-based auth for every caller, human or not).
 * - `locked`: accepted the first time a value is set; a *change* to a value
 *   that already exists is rejected outright, from any path.
 * - `calculated`: the client's value is silently dropped (never merged,
 *   never type-checked) and recomputed from the record's other values —
 *   *every* calculated Field the journey defines, not only ones the caller's
 *   `fieldValues` happened to mention, so a formula stays correct no matter
 *   which write path changed the field(s) it depends on.
 * - `system`: the client's value is silently dropped, same as `calculated`.
 *   No catalog of system-populated values exists yet (deliberately deferred
 *   — see `computeSystemValue`), so nothing currently replaces it; it simply
 *   keeps whatever it already had. Exempted from the required-field check
 *   below for the same reason: the platform cannot populate it yet, so
 *   requiring one would be an unsatisfiable rule until it can.
 */
export function validateFieldValues(input: {
  settings: readonly LeadFieldSetting[];
  fieldValues: Record<string, unknown>;
  existingFieldValues?: Record<string, unknown>;
  statusId: string;
}): Record<string, unknown> {
  const settingsByField = new Map(input.settings.map((setting) => [setting.fieldId, setting]));
  const existing = input.existingFieldValues ?? {};

  for (const fieldId of Object.keys(input.fieldValues)) {
    const setting = settingsByField.get(fieldId);
    if (setting === undefined || !setting.active || !setting.field.active) {
      throw new LeadError('validation_error', 'field is not assigned to this journey', { fieldId });
    }
    if (setting.requirement === 'hidden') {
      throw new LeadError('validation_error', 'field is hidden for this journey', { fieldId });
    }
  }

  // Server-decided modes never accept a client value, whatever was sent —
  // dropping it here (rather than rejecting the request) is what lets a
  // caller harmlessly echo a record's own computed values back on save.
  const acceptedFieldValues: Record<string, unknown> = {};
  for (const [fieldId, value] of Object.entries(input.fieldValues)) {
    const editMode = settingsByField.get(fieldId)!.field.editMode;
    if (editMode === 'calculated' || editMode === 'system') continue;
    if (editMode === 'locked') {
      const priorValue = existing[fieldId];
      if (!isMissing(priorValue) && !sameValue(priorValue, value)) {
        throw new LeadError('validation_error', 'field is locked and cannot be changed', {
          fieldId,
        });
      }
    }
    acceptedFieldValues[fieldId] = value;
  }

  for (const [fieldId, value] of Object.entries(acceptedFieldValues)) {
    const setting = settingsByField.get(fieldId)!;
    validateValue(fieldId, value, setting.field.fieldType, setting.field.validationRule);
  }

  const merged: Record<string, unknown> = { ...existing, ...acceptedFieldValues };

  // Recompute every calculated Field from the merged base values above —
  // never from `merged` as it grows, so one calculated Field can never feed
  // another (config-time validation already refuses that chain; this is the
  // belt to its suspenders).
  const baseValues = { ...merged };
  for (const setting of input.settings) {
    if (!setting.active || !setting.field.active || setting.field.editMode !== 'calculated') {
      continue;
    }
    const config = extractCalculationConfig(setting.field.validationRule);
    if (config === null) continue;
    const computed = computeCalculatedValue(config, baseValues);
    if (computed === undefined) delete merged[setting.fieldId];
    else merged[setting.fieldId] = computed;
  }

  // `system` Fields: the extension point for a catalog that hasn't been
  // decided yet. `computeSystemValue` always returns `undefined` today — an
  // admin can mark a Field `system` and name a key for it, but nothing sets
  // it until a real key is implemented there. Wiring one in later is meant
  // to be exactly that: add a case, nothing here or upstream has to change.
  for (const setting of input.settings) {
    if (!setting.active || !setting.field.active || setting.field.editMode !== 'system') continue;
    const key = extractSystemKey(setting.field.validationRule);
    if (key === null) continue;
    const computed = computeSystemValue(key, merged);
    if (computed !== undefined) merged[setting.fieldId] = computed;
  }

  for (const setting of input.settings) {
    if (!setting.active || !setting.field.active || setting.requirement === 'hidden') continue;
    if (setting.field.editMode === 'system') continue;
    const required =
      setting.requirement === 'required' &&
      (setting.requiredFromStatusId === null || setting.requiredFromStatusId === input.statusId);
    if (required && isMissing(merged[setting.fieldId])) {
      throw new LeadError('validation_error', 'required field is missing', {
        fieldId: setting.fieldId,
      });
    }
  }

  return merged;
}

function extractCalculationConfig(validationRule: unknown): CalculationConfig | null {
  if (typeof validationRule !== 'object' || validationRule === null) return null;
  const calculation = (validationRule as Record<string, unknown>).calculation;
  return isCalculationConfig(calculation) ? calculation : null;
}

function extractSystemKey(validationRule: unknown): string | null {
  if (typeof validationRule !== 'object' || validationRule === null) return null;
  const system = (validationRule as Record<string, unknown>).system;
  if (typeof system !== 'object' || system === null) return null;
  const key = (system as Record<string, unknown>).key;
  return typeof key === 'string' && key.trim() !== '' ? key : null;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * No system-populated values are implemented yet — see this function's
 * callsite above. `key` and `fieldValues` are already exactly what a real
 * implementation would need (the admin-configured key, and the record's
 * other values, the same shape `computeCalculatedValue` reads), so adding
 * one is additive here, not a redesign.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- deliberately unused until a real key is implemented
function computeSystemValue(key: string, fieldValues: Readonly<Record<string, unknown>>): unknown {
  return undefined;
}

function isMissing(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

function validateValue(
  fieldId: string,
  value: unknown,
  fieldType: string,
  validationRule: unknown,
): void {
  if (value === null || value === undefined) return;
  switch (fieldType) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'phone':
    case 'date':
    case 'select':
      if (typeof value !== 'string') throw invalid(fieldId, fieldType);
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(fieldId, fieldType);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') throw invalid(fieldId, fieldType);
      break;
    case 'json':
      break;
    default:
      throw new LeadError('validation_error', 'unsupported field type', { fieldId, fieldType });
  }

  if (typeof value === 'string' && isRuleObject(validationRule)) {
    if (
      typeof validationRule.pattern === 'string' &&
      !new RegExp(validationRule.pattern).test(value)
    ) {
      throw new LeadError('validation_error', 'field validation rule failed', { fieldId });
    }
    if (typeof validationRule.minLength === 'number' && value.length < validationRule.minLength) {
      throw new LeadError('validation_error', 'field validation rule failed', { fieldId });
    }
    if (typeof validationRule.maxLength === 'number' && value.length > validationRule.maxLength) {
      throw new LeadError('validation_error', 'field validation rule failed', { fieldId });
    }
  }
}

function invalid(fieldId: string, fieldType: string): LeadError {
  return new LeadError('validation_error', 'field value type is invalid', { fieldId, fieldType });
}

function isRuleObject(
  value: unknown,
): value is { pattern?: unknown; minLength?: unknown; maxLength?: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
