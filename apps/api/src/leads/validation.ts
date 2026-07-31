import { LeadError } from './errors.js';

export interface LeadFieldDefinition {
  id: string;
  fieldType: string;
  validationRule: unknown;
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

export function validateFieldValues(input: {
  settings: readonly LeadFieldSetting[];
  fieldValues: Record<string, unknown>;
  existingFieldValues?: Record<string, unknown>;
  statusId: string;
}): Record<string, unknown> {
  const settingsByField = new Map(input.settings.map((setting) => [setting.fieldId, setting]));
  for (const fieldId of Object.keys(input.fieldValues)) {
    const setting = settingsByField.get(fieldId);
    if (setting === undefined || !setting.active || !setting.field.active) {
      throw new LeadError('validation_error', 'field is not assigned to this journey', { fieldId });
    }
    if (setting.requirement === 'hidden') {
      throw new LeadError('validation_error', 'field is hidden for this journey', { fieldId });
    }
  }

  const merged = { ...(input.existingFieldValues ?? {}), ...input.fieldValues };
  for (const setting of input.settings) {
    if (!setting.active || !setting.field.active || setting.requirement === 'hidden') continue;
    const required =
      setting.requirement === 'required' &&
      (setting.requiredFromStatusId === null || setting.requiredFromStatusId === input.statusId);
    if (required && isMissing(merged[setting.fieldId])) {
      throw new LeadError('validation_error', 'required field is missing', {
        fieldId: setting.fieldId,
      });
    }
  }

  for (const [fieldId, value] of Object.entries(input.fieldValues)) {
    const setting = settingsByField.get(fieldId)!;
    validateValue(fieldId, value, setting.field.fieldType, setting.field.validationRule);
  }
  return merged;
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
