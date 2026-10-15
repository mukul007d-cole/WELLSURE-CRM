import type { FieldDefinition } from '../../types/domain';
import { fromDateTimeLocal } from './status-entry';

/** What one required-field input holds while the dialog is open. */
export type FieldDraft = string | string[] | boolean;

/**
 * Edit modes the user can't type into: the server computes or owns these
 * (see `DynamicFieldControl`). A status requiring one has to be satisfied
 * some other way, so the dialog points at the seller form instead.
 */
const NON_MANUAL_EDIT_MODES: ReadonlySet<string> = new Set(['calculated', 'system', 'api-only']);

export function isFillableHere(field: FieldDefinition): boolean {
  return !NON_MANUAL_EDIT_MODES.has(field.editMode);
}

export function emptyDraft(field: FieldDefinition): FieldDraft {
  if (field.type === 'boolean') return false;
  if (field.type === 'multi_select') return [];
  return '';
}

/**
 * A draft as the API stores the Field's type, or an error to show beside it.
 * Every field reaching here is required, so blank is always an error.
 */
export function draftToFieldValue(
  field: FieldDefinition,
  draft: FieldDraft,
): { value: unknown } | { error: string } {
  if (field.type === 'boolean') return { value: Boolean(draft) };
  if (Array.isArray(draft)) {
    return draft.length > 0 ? { value: draft } : { error: 'Choose at least one option.' };
  }
  const raw = typeof draft === 'string' ? draft.trim() : '';
  if (raw === '') return { error: 'Fill this in to make the move.' };
  if (field.type === 'number') {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? { error: 'Enter a number.' } : { value: parsed };
  }
  if (field.type === 'datetime') {
    const iso = fromDateTimeLocal(raw);
    return iso === null ? { error: 'Enter a valid date and time.' } : { value: iso };
  }
  return { value: raw };
}
