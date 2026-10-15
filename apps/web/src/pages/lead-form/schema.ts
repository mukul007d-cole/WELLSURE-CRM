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
  /** A `multi_select` Field holds the ticked options as a string[]; every other type a scalar. */
  fields: z.record(z.string(), z.union([z.string(), z.boolean(), z.array(z.string())])),
});

export type LeadFormValues = z.infer<typeof leadFormSchema>;
export type FormFieldValue = LeadFormValues['fields'][string];

/**
 * The form schema with the rendered Fields' own values checked too: a value
 * shaped for its type (`fieldValueIssue`), and a value at all for those in
 * `required` (see `isRequiredNow`). Without either it is `leadFormSchema`
 * unchanged. The server enforces the same rules on save either way; this
 * only names the problem beside its control instead of after a round trip.
 */
export function leadFormSchemaFor(
  fields: readonly FieldDefinition[],
  required: readonly Pick<FieldDefinition, 'key' | 'label'>[] = [],
) {
  if (fields.length === 0 && required.length === 0) return leadFormSchema;
  return leadFormSchema.superRefine((values, ctx) => {
    const flagged = new Set<string>();
    for (const field of fields) {
      const message = fieldValueIssue(field, values.fields[field.key]);
      if (message === null) continue;
      flagged.add(field.key);
      ctx.addIssue({ code: 'custom', path: ['fields', field.key], message });
    }
    for (const field of required) {
      if (flagged.has(field.key) || !isBlank(values.fields[field.key])) continue;
      ctx.addIssue({
        code: 'custom',
        path: ['fields', field.key],
        message: `${field.label} is required`,
      });
    }
  });
}

/** "YYYY-MM-DDTHH:mm", optionally with seconds — what `datetime-local` produces. */
const dateTimeInputPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/;

/**
 * Why a Field's form value would be refused for its type, or null. Only the
 * types whose control can hold something the server rejects are checked; a
 * blank value is `required`'s question, not this one's.
 */
export function fieldValueIssue(
  field: Pick<FieldDefinition, 'type' | 'label' | 'options'>,
  value: FormFieldValue | undefined,
): string | null {
  if (value === undefined || isBlank(value)) return null;
  if (field.type === 'datetime') {
    return typeof value === 'string' &&
      dateTimeInputPattern.test(value) &&
      !Number.isNaN(new Date(value).getTime())
      ? null
      : `Enter a date and time for ${field.label}`;
  }
  if (field.type === 'multi_select') {
    if (!Array.isArray(value)) return `Choose from the ${field.label} options`;
    // The server refuses a value outside the Field's options; one the admin
    // has since removed stays listed on the control so it can be unticked.
    const options = field.options;
    const retired = options ? value.filter((item) => !options.includes(item)) : [];
    if (retired.length > 0)
      return `“${retired.join('”, “')}” is no longer an option for ${field.label} — untick it to save`;
  }
  return null;
}

/** Mirrors the server's own `isMissing`: blank text and an empty list are not values. */
function isBlank(value: FormFieldValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** The parts of a `field_journey_settings` row that decide whether a value is required. */
export interface FieldRequirementSetting {
  requirement: string;
  requiredFromStatusId?: string | null | undefined;
  /** ADR-0026 — for `required_on_create`: the roles it applies to; empty = every role. */
  requiredRoleIds?: readonly string[] | undefined;
}

/**
 * The server's rule (`validateFieldValues`), restated for the form:
 * `required` while the lead is in `requiredFromStatusId` (or always, when
 * unset); `required_on_create` only when creating, and only for the roles it
 * names. A role the client can't determine matches no named role, the same
 * answer the server gives an actor without one.
 */
export function isRequiredNow(
  setting: FieldRequirementSetting,
  context: { creating: boolean; statusId: string | undefined; roleId: string | undefined },
): boolean {
  if (setting.requirement === 'required')
    return (
      setting.requiredFromStatusId === null ||
      setting.requiredFromStatusId === undefined ||
      setting.requiredFromStatusId === context.statusId
    );
  if (setting.requirement === 'required_on_create') {
    if (!context.creating) return false;
    const roles = setting.requiredRoleIds ?? [];
    return roles.length === 0 || (context.roleId !== undefined && roles.includes(context.roleId));
  }
  return false;
}

/**
 * `datetime` values are ISO-8601 instants on the wire; `<input
 * type="datetime-local">` wants local wall-clock "YYYY-MM-DDTHH:mm". Blank for
 * anything that doesn't parse, so a malformed stored value reopens empty
 * rather than crashing the form.
 */
export function toDateTimeInput(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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
): Record<string, FormFieldValue> {
  const result: Record<string, FormFieldValue> = {};
  for (const field of fields) {
    const value = existing?.[field.id];
    if (field.type === 'boolean') {
      result[field.key] = Boolean(value);
    } else if (field.type === 'multi_select') {
      result[field.key] = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
    } else if (field.type === 'datetime') {
      result[field.key] = toDateTimeInput(value);
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
  formFields: Record<string, FormFieldValue>,
  /** The record's stored values when editing — see the `datetime` case. */
  existing?: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = formFields[field.key];
    if (field.type === 'boolean') {
      result[field.id] = Boolean(raw);
      continue;
    }
    if (field.type === 'multi_select') {
      // Empty is skipped like a blank text value — nothing is sent.
      if (Array.isArray(raw) && raw.length > 0) result[field.id] = raw;
      continue;
    }
    if (raw === '' || raw === undefined || Array.isArray(raw)) continue;
    if (field.type === 'datetime') {
      if (typeof raw !== 'string') continue;
      // The input only has minute precision in local time, so converting an
      // untouched value back would rewrite the stored instant (its offset,
      // its seconds) on every save. Echo the stored value when what's on
      // screen is still exactly what it showed.
      const previous = existing?.[field.id];
      if (typeof previous === 'string' && toDateTimeInput(previous) === raw) {
        result[field.id] = previous;
        continue;
      }
      // `new Date("YYYY-MM-DDTHH:mm")` reads the wall-clock time as local,
      // which is what the person picked; the server wants an ISO instant.
      const date = new Date(raw);
      if (!Number.isNaN(date.getTime())) result[field.id] = date.toISOString();
      continue;
    }
    if (field.type === 'number') {
      const parsed = Number(raw);
      result[field.id] = Number.isNaN(parsed) ? undefined : parsed;
      continue;
    }
    result[field.id] = raw;
  }
  return result;
}
