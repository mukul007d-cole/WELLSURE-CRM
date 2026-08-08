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

export function defaultFieldValues(
  fields: FieldDefinition[],
  existing?: Record<string, unknown>,
): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (const field of fields) {
    const value = existing?.[field.key];
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
      result[field.key] = Boolean(raw);
      continue;
    }
    if (raw === '' || raw === undefined) continue;
    if (field.type === 'number') {
      const parsed = Number(raw);
      result[field.key] = Number.isNaN(parsed) ? undefined : parsed;
      continue;
    }
    result[field.key] = raw;
  }
  return result;
}
