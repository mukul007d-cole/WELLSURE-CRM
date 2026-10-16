import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '../../types/domain';
import {
  defaultFieldValues,
  fieldValueIssue,
  isRequiredNow,
  leadFormSchemaFor,
  toDateTimeInput,
  toFieldValues,
} from './schema';

const FIELDS: FieldDefinition[] = [
  { id: 'f1', key: 'company_name', label: 'Company Name', type: 'text', editMode: 'manual' },
  {
    id: 'f2',
    key: 'monthly_revenue',
    label: 'Monthly Revenue',
    type: 'number',
    editMode: 'manual',
  },
  { id: 'f3', key: 'is_priority', label: 'Priority', type: 'boolean', editMode: 'manual' },
];

describe('defaultFieldValues', () => {
  it('stringifies existing non-boolean values and coerces booleans', () => {
    // `existing` is the server's own fieldValues object — keyed by Field id,
    // never by key. The result is the *form's* namespace, keyed by key.
    const result = defaultFieldValues(FIELDS, {
      f1: 'Acme',
      f2: 5000,
      f3: true,
    });
    expect(result).toEqual({ company_name: 'Acme', monthly_revenue: '5000', is_priority: true });
  });

  it('falls back to empty string / false when no existing value is given', () => {
    const result = defaultFieldValues(FIELDS);
    expect(result).toEqual({ company_name: '', monthly_revenue: '', is_priority: false });
  });
});

describe('toFieldValues', () => {
  it('parses numbers, keeps booleans, and drops empty strings', () => {
    // `formFields` is the form's own namespace, keyed by key. The result goes
    // straight into the API request body, so it must be keyed by Field id.
    const result = toFieldValues(FIELDS, {
      company_name: '',
      monthly_revenue: '12000',
      is_priority: true,
    });
    expect(result).toEqual({ f2: 12000, f3: true });
  });

  it('drops a number field entirely when it fails to parse', () => {
    const result = toFieldValues(FIELDS, {
      company_name: 'Acme',
      monthly_revenue: 'not-a-number',
      is_priority: false,
    });
    expect(result.f2).toBeUndefined();
    expect(result.f1).toBe('Acme');
    expect(result.f3).toBe(false);
  });
});

const MULTI: FieldDefinition = {
  id: 'f4',
  key: 'channels',
  label: 'Channels',
  type: 'multi_select',
  options: ['Option A', 'Option B', 'Option C'],
  editMode: 'manual',
};
const DATETIME: FieldDefinition = {
  id: 'f5',
  key: 'last_contacted',
  label: 'Last Contacted',
  type: 'datetime',
  editMode: 'manual',
};

/** A complete, otherwise-valid form value, so only `fields` varies per test. */
function formValues(fields: Record<string, string | boolean | string[]>) {
  return { name: 'Synthetic Co', journeyId: 'journey-1', fields };
}

describe('multi_select and datetime values', () => {
  it('reads a stored list and ISO instant into the form’s own shapes', () => {
    const instant = '2026-03-04T10:30:00.000Z';
    const result = defaultFieldValues([MULTI, DATETIME], { f4: ['Option B'], f5: instant });
    expect(result.channels).toEqual(['Option B']);
    // Local wall-clock, minute precision — exactly what datetime-local shows.
    expect(result.last_contacted).toBe(toDateTimeInput(instant));
    expect(result.last_contacted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('opens blank rather than crashing on an absent or malformed stored value', () => {
    expect(defaultFieldValues([MULTI, DATETIME])).toEqual({ channels: [], last_contacted: '' });
    expect(defaultFieldValues([MULTI, DATETIME], { f4: 'not a list', f5: 'nope' })).toEqual({
      channels: [],
      last_contacted: '',
    });
  });

  it('sends a picked datetime as an ISO instant and the ticked options as a list', () => {
    const result = toFieldValues([MULTI, DATETIME], {
      channels: ['Option A', 'Option C'],
      last_contacted: '2026-03-04T10:30',
    });
    expect(result).toEqual({
      f4: ['Option A', 'Option C'],
      f5: new Date('2026-03-04T10:30').toISOString(),
    });
  });

  it('sends nothing for an empty list or a blank datetime', () => {
    expect(toFieldValues([MULTI, DATETIME], { channels: [], last_contacted: '' })).toEqual({});
  });

  it('echoes an untouched stored datetime rather than rewriting its precision', () => {
    // Seconds and an offset the minute-precision input can't show.
    const stored = '2026-03-04T10:30:45+05:30';
    const shown = toDateTimeInput(stored);
    expect(toFieldValues([DATETIME], { last_contacted: shown }, { f5: stored })).toEqual({
      f5: stored,
    });
    // Once edited, it is the newly picked instant.
    expect(
      toFieldValues([DATETIME], { last_contacted: '2026-03-05T09:00' }, { f5: stored }),
    ).toEqual({ f5: new Date('2026-03-05T09:00').toISOString() });
  });
});

describe('fieldValueIssue', () => {
  it('accepts what the controls produce, and blanks (that is required’s question)', () => {
    expect(fieldValueIssue(DATETIME, '2026-03-04T10:30')).toBeNull();
    expect(fieldValueIssue(DATETIME, '')).toBeNull();
    expect(fieldValueIssue(MULTI, ['Option A'])).toBeNull();
    expect(fieldValueIssue(MULTI, [])).toBeNull();
  });

  it('refuses a datetime without a time or that does not parse', () => {
    expect(fieldValueIssue(DATETIME, '2026-03-04')).toMatch(/date and time/);
    expect(fieldValueIssue(DATETIME, '2026-13-45T99:99')).toMatch(/date and time/);
  });

  it('names a multi-select option the Field no longer offers', () => {
    expect(fieldValueIssue(MULTI, ['Option A', 'Retired Option'])).toMatch(/Retired Option/);
    expect(fieldValueIssue(MULTI, 'Option A')).not.toBeNull();
  });
});

describe('leadFormSchemaFor', () => {
  it('is the plain schema when no Field needs checking', () => {
    expect(leadFormSchemaFor([]).safeParse(formValues({})).success).toBe(true);
  });

  it('reports a required blank and a malformed value against their own Field', () => {
    const result = leadFormSchemaFor([MULTI, DATETIME], [MULTI]).safeParse(
      formValues({ channels: [], last_contacted: '2026-03-04' }),
    );
    expect(result.success).toBe(false);
    const issues = result.error?.issues.map((issue) => [issue.path.join('.'), issue.message]);
    expect(issues).toEqual([
      ['fields.last_contacted', expect.stringMatching(/date and time/)],
      ['fields.channels', 'Channels is required'],
    ]);
  });

  it('passes once the required list holds a value', () => {
    expect(
      leadFormSchemaFor([MULTI], [MULTI]).safeParse(formValues({ channels: ['Option B'] })).success,
    ).toBe(true);
  });
});

describe('isRequiredNow', () => {
  const create = { creating: true, statusId: 'status-1', roleId: 'role-a' };
  const edit = { ...create, creating: false };

  it('applies required_on_create to every role when it names none, on create only', () => {
    const setting = { requirement: 'required_on_create', requiredRoleIds: [] };
    expect(isRequiredNow(setting, create)).toBe(true);
    expect(isRequiredNow({ requirement: 'required_on_create' }, create)).toBe(true);
    // Migrated leads lacking the value must stay editable (ADR-0026).
    expect(isRequiredNow(setting, edit)).toBe(false);
  });

  it('applies required_on_create only to the roles it names', () => {
    const setting = { requirement: 'required_on_create', requiredRoleIds: ['role-a'] };
    expect(isRequiredNow(setting, create)).toBe(true);
    expect(isRequiredNow(setting, { ...create, roleId: 'role-b' })).toBe(false);
    // A role the client doesn't know matches no named role.
    expect(isRequiredNow(setting, { ...create, roleId: undefined })).toBe(false);
  });

  it('keeps required’s "while in this status" meaning, on create and edit alike', () => {
    expect(isRequiredNow({ requirement: 'required', requiredFromStatusId: null }, edit)).toBe(true);
    const gated = { requirement: 'required', requiredFromStatusId: 'status-2' };
    expect(isRequiredNow(gated, create)).toBe(false);
    expect(isRequiredNow(gated, { ...edit, statusId: 'status-2' })).toBe(true);
    expect(isRequiredNow({ requirement: 'optional' }, create)).toBe(false);
  });
});
