import type { FieldDefinition } from '../types/domain';

/** Field values are validated server-side to be primitives for their type; this is a safe, typed fallback. */
function toDisplayString(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function formatFieldValue(field: FieldDefinition, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';

  switch (field.type) {
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'number':
      return typeof value === 'number' ? value.toLocaleString('en-IN') : toDisplayString(value);
    case 'date':
      try {
        return new Date(toDisplayString(value)).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
      } catch {
        return toDisplayString(value);
      }
    default:
      return toDisplayString(value);
  }
}

export function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
