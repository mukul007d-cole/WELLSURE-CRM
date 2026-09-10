import { describe, expect, it } from 'vitest';

import { LeadError } from '../leads/errors.js';
import { validateFieldValues, type LeadFieldSetting } from '../leads/validation.js';

const journeyId = 'journey-a';
const statusId = 'status-open';

function setting(overrides: {
  fieldId: string;
  requirement?: string;
  requiredFromStatusId?: string | null;
  active?: boolean;
  field?: Partial<LeadFieldSetting['field']>;
}): LeadFieldSetting {
  return {
    fieldId: overrides.fieldId,
    journeyId,
    requirement: overrides.requirement ?? 'optional',
    requiredFromStatusId: overrides.requiredFromStatusId ?? null,
    active: overrides.active ?? true,
    field: {
      id: overrides.fieldId,
      fieldType: 'text',
      validationRule: null,
      editMode: 'manual',
      active: true,
      ...overrides.field,
    },
  };
}

/**
 * Every path that writes `Lead.field_values` — `createLead`, `editLead`, the
 * `existingLeadId` merge branch, and bulk import (which calls `createLead`
 * too, per row) — funnels through `validateFieldValues`. Testing the pure
 * function directly, rather than through each of those four call sites'
 * fakes, is what makes it possible to assert the same enforcement holds for
 * fresh creation *and* an edit *and* a merge onto an existing record without
 * four near-duplicate test suites.
 */
describe('validateFieldValues — editMode enforcement', () => {
  describe('manual (default)', () => {
    it('accepts a value and lets it be changed freely', () => {
      const settings = [setting({ fieldId: 'field-name' })];
      const first = validateFieldValues({
        settings,
        fieldValues: { 'field-name': 'Acme' },
        statusId,
      });
      expect(first).toEqual({ 'field-name': 'Acme' });

      const second = validateFieldValues({
        settings,
        fieldValues: { 'field-name': 'Acme Corp' },
        existingFieldValues: first,
        statusId,
      });
      expect(second).toEqual({ 'field-name': 'Acme Corp' });
    });
  });

  describe('api-only', () => {
    it('is accepted the same as manual — enforcement for it is UI-only, not server-side', () => {
      const settings = [setting({ fieldId: 'field-ext', field: { editMode: 'api-only' } })];
      const result = validateFieldValues({
        settings,
        fieldValues: { 'field-ext': 'from an API caller' },
        statusId,
      });
      expect(result).toEqual({ 'field-ext': 'from an API caller' });
    });
  });

  describe('locked', () => {
    const settings = [setting({ fieldId: 'field-gst', field: { editMode: 'locked' } })];

    it('accepts the first value — a locked field has to be set once', () => {
      const result = validateFieldValues({
        settings,
        fieldValues: { 'field-gst': 'GSTIN123' },
        statusId,
      });
      expect(result).toEqual({ 'field-gst': 'GSTIN123' });
    });

    it('rejects a change to a value that already exists, from any path', () => {
      expect(() =>
        validateFieldValues({
          settings,
          fieldValues: { 'field-gst': 'GSTIN456' },
          existingFieldValues: { 'field-gst': 'GSTIN123' },
          statusId,
        }),
      ).toThrow(LeadError);
      try {
        validateFieldValues({
          settings,
          fieldValues: { 'field-gst': 'GSTIN456' },
          existingFieldValues: { 'field-gst': 'GSTIN123' },
          statusId,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(LeadError);
        expect((error as LeadError).details).toEqual({ fieldId: 'field-gst' });
      }
    });

    it('allows an idempotent write of the same value rather than treating a no-op as a change', () => {
      const result = validateFieldValues({
        settings,
        fieldValues: { 'field-gst': 'GSTIN123' },
        existingFieldValues: { 'field-gst': 'GSTIN123' },
        statusId,
      });
      expect(result).toEqual({ 'field-gst': 'GSTIN123' });
    });

    it('accepts setting it for the first time even when other fields already exist on the record', () => {
      const result = validateFieldValues({
        settings,
        fieldValues: { 'field-gst': 'GSTIN123' },
        existingFieldValues: {},
        statusId,
      });
      expect(result).toEqual({ 'field-gst': 'GSTIN123' });
    });
  });

  describe('calculated — arithmetic', () => {
    const settings = [
      setting({ fieldId: 'field-revenue', field: { fieldType: 'number' } }),
      setting({
        fieldId: 'field-deal-value',
        field: {
          fieldType: 'number',
          editMode: 'calculated',
          validationRule: {
            calculation: {
              kind: 'arithmetic',
              left: { type: 'field', fieldId: 'field-revenue' },
              operator: '*',
              right: { type: 'constant', value: 12 },
            },
          },
        },
      }),
    ];

    it('computes the calculated field and silently drops whatever the client sent for it', () => {
      const result = validateFieldValues({
        settings,
        fieldValues: { 'field-revenue': 1000, 'field-deal-value': 999_999 },
        statusId,
      });
      expect(result).toEqual({ 'field-revenue': 1000, 'field-deal-value': 12_000 });
    });

    it('recomputes when the input changes on an edit, even though the caller never mentions the calculated field', () => {
      const created = validateFieldValues({
        settings,
        fieldValues: { 'field-revenue': 1000 },
        statusId,
      });
      expect(created['field-deal-value']).toBe(12_000);

      const edited = validateFieldValues({
        settings,
        fieldValues: { 'field-revenue': 2000 },
        existingFieldValues: created,
        statusId,
      });
      expect(edited).toEqual({ 'field-revenue': 2000, 'field-deal-value': 24_000 });
    });

    it('leaves the calculated field unset when an input is missing', () => {
      const result = validateFieldValues({ settings, fieldValues: {}, statusId });
      expect(result).toEqual({});
    });
  });

  describe('calculated — template', () => {
    const settings = [
      setting({ fieldId: 'field-company', field: { fieldType: 'text' } }),
      setting({ fieldId: 'field-marketplace', field: { fieldType: 'text' } }),
      setting({
        fieldId: 'field-label',
        field: {
          fieldType: 'text',
          editMode: 'calculated',
          validationRule: {
            calculation: {
              kind: 'template',
              template: '{{field:field-company}} — {{field:field-marketplace}}',
            },
          },
        },
      }),
    ];

    it('computes the label from the referenced fields', () => {
      const result = validateFieldValues({
        settings,
        fieldValues: { 'field-company': 'Acme', 'field-marketplace': 'Amazon' },
        statusId,
      });
      expect(result['field-label']).toBe('Acme — Amazon');
    });
  });

  describe('system', () => {
    const settings = [setting({ fieldId: 'field-sys', field: { editMode: 'system' } })];

    it('silently drops a client-supplied value', () => {
      const result = validateFieldValues({
        settings,
        fieldValues: { 'field-sys': 'a client should not be able to set this' },
        statusId,
      });
      expect(result).toEqual({});
    });

    it('leaves an existing value untouched when nothing computes a replacement yet', () => {
      const result = validateFieldValues({
        settings,
        fieldValues: {},
        existingFieldValues: { 'field-sys': 'set by some future trigger' },
        statusId,
      });
      expect(result).toEqual({ 'field-sys': 'set by some future trigger' });
    });

    it('is exempt from the required-field check — the platform cannot populate it yet', () => {
      const requiredSystemSettings = [
        setting({
          fieldId: 'field-sys',
          requirement: 'required',
          field: { editMode: 'system' },
        }),
      ];
      expect(() =>
        validateFieldValues({ settings: requiredSystemSettings, fieldValues: {}, statusId }),
      ).not.toThrow();
    });
  });

  it('still enforces the required-field check for manual/locked fields', () => {
    const settings = [
      setting({ fieldId: 'field-name', requirement: 'required' }),
      setting({ fieldId: 'field-gst', requirement: 'required', field: { editMode: 'locked' } }),
    ];
    expect(() => validateFieldValues({ settings, fieldValues: {}, statusId })).toThrow(
      'required field is missing',
    );
  });
});
