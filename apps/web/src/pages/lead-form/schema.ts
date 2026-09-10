import { z } from 'zod';
import type { FieldDefinition } from '../../types/domain';

export const leadFormSchema = z.object({
  name: z.string().min(1, 'Enter a company or contact name'),
  phone: z.string().optional(),
  email: z.union([z.literal(''), z.string().email('Enter a valid email address')]).optional(),
  journeyId: z.string().min(1, 'Choose a journey'),
  statusId: z.string().optional(),
  /**
   * Required on create only (enforced in the page, which knows the mode).
   * assignment_type is caller-configured free text — the API defines no
   * canonical value — so this is never defaulted to a literal.
   */
  assignmentType: z.string().optional(),
  fields: z.record(z.string(), z.union([z.string(), z.boolean()])),
});

export type LeadFormValues = z.infer<typeof leadFormSchema>;

/**
 * `field.key` is only ever the *form's* own local namespace here — it's what
 * `DynamicFieldControl` registers each input under, purely so the on-screen
 * control has a stable, readable react-hook-form path. The API's own
 * `fieldValues` object (both what it returns and what it accepts back) is
 * keyed by Field **id**: `field_values` is a JSONB column the backend
 * addresses by id everywhere — the GIN-indexed containment queries,
 * `field_journey_settings`, field-visibility redaction (`resolveAuthorization`'s
 * `requestedEditFieldIds` is checked against real field ids, and rejects
 * anything else with an invalid-uuid error rather than a clean 400). These two
 * functions are the one place that translates between the two: reading the
 * server's id-keyed object into the form's key-keyed one, and back.
 */
export function defaultFieldValues(
  fields: FieldDefinition[],
  existing?: Record<string, unknown>,
): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (const field of fields) {
    const value = existing?.[field.id];
    if (field.type === 'boolean') {
      result[field.key] = Boolean(value);
    } else if (value === null || value === undefined) {
      result[field.key] = '';
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      result[field.key] = String(value);
    } else {
      result[field.key] = JSON.stringify(value);
    }
  }
  return result;
}

export function toFieldValues(
  fields: FieldDefinition[],
  formFields: Record<string, string | boolean>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = formFields[field.key];
    if (field.type === 'boolean') {
      result[field.id] = Boolean(raw);
      continue;
    }
    if (raw === '' || raw === undefined) continue;
    if (field.type === 'number') {
      const parsed = Number(raw);
      result[field.id] = Number.isNaN(parsed) ? undefined : parsed;
      continue;
    }
    result[field.id] = raw;
  }
  return result;
}
