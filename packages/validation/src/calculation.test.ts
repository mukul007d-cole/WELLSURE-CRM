import { describe, expect, it } from 'vitest';

import {
  computeCalculatedValue,
  isCalculationConfig,
  parseCalculationConfig,
  type ReferenceableField,
} from './calculation.js';

const revenueField: ReferenceableField = { fieldType: 'number', editMode: 'manual', active: true };
const companyField: ReferenceableField = { fieldType: 'text', editMode: 'manual', active: true };
const inactiveField: ReferenceableField = { fieldType: 'number', editMode: 'manual', active: false };
const calculatedField: ReferenceableField = {
  fieldType: 'number',
  editMode: 'calculated',
  active: true,
};

describe('parseCalculationConfig — arithmetic', () => {
  const referenceable = new Map([
    ['field-revenue', revenueField],
    ['field-inactive', inactiveField],
    ['field-calc', calculatedField],
    ['field-company', companyField],
  ]);

  it('accepts field × constant on a number field', () => {
    const result = parseCalculationConfig({
      raw: {
        kind: 'arithmetic',
        left: { type: 'field', fieldId: 'field-revenue' },
        operator: '*',
        right: { type: 'constant', value: 12 },
      },
      fieldType: 'number',
      ownFieldId: 'field-deal-value',
      referenceable,
    });
    expect(result).toEqual({
      ok: true,
      config: {
        kind: 'arithmetic',
        left: { type: 'field', fieldId: 'field-revenue' },
        operator: '*',
        right: { type: 'constant', value: 12 },
      },
    });
  });

  it('refuses arithmetic on a non-number field', () => {
    const result = parseCalculationConfig({
      raw: {
        kind: 'arithmetic',
        left: { type: 'constant', value: 1 },
        operator: '+',
        right: { type: 'constant', value: 1 },
      },
      fieldType: 'text',
      ownFieldId: null,
      referenceable,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses an unknown operator', () => {
    const result = parseCalculationConfig({
      raw: {
        kind: 'arithmetic',
        left: { type: 'constant', value: 1 },
        operator: '%',
        right: { type: 'constant', value: 1 },
      },
      fieldType: 'number',
      ownFieldId: null,
      referenceable,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a field operand that does not exist', () => {
    const result = parseCalculationConfig({
      raw: {
        kind: 'arithmetic',
        left: { type: 'field', fieldId: 'field-missing' },
        operator: '+',
        right: { type: 'constant', value: 1 },
      },
      fieldType: 'number',
      ownFieldId: null,
      referenceable,
    });
    expect(result).toEqual({
      ok: false,
      reason: 'calculation references a field that does not exist',
    });
  });

  it('refuses a field operand that is inactive', () => {
    const result = parseCalculationConfig({
      raw: {
        kind: 'arithmetic',
        left: { type: 'field', fieldId: 'field-inactive' },
        operator: '+',
        right: { type: 'constant', value: 1 },
      },
      fieldType: 'number',
      ownFieldId: null,
      referenceable,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses chaining onto another calculated field', () => {
    const result = parseCalculationConfig({
      raw: {
        kind: 'arithmetic',
        left: { type: 'field', fieldId: 'field-calc' },
        operator: '+',
        right: { type: 'constant', value: 1 },
      },
      fieldType: 'number',
      ownFieldId: null,
      referenceable,
    });
    expect(result).toEqual({
      ok: false,
      reason: 'a calculated field cannot reference another calculated field',
    });
  });

  it('refuses a field operand that is not numeric', () => {
    const result = parseCalculationConfig({
      raw: {
        kind: 'arithmetic',
        left: { type: 'field', fieldId: 'field-company' },
        operator: '+',
        right: { type: 'constant', value: 1 },
      },
      fieldType: 'number',
      ownFieldId: null,
      referenceable,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a self-reference', () => {
    const result = parseCalculationConfig({
      raw: {
        kind: 'arithmetic',
        left: { type: 'field', fieldId: 'field-deal-value' },
        operator: '+',
        right: { type: 'constant', value: 1 },
      },
      fieldType: 'number',
      ownFieldId: 'field-deal-value',
      referenceable,
    });
    expect(result).toEqual({ ok: false, reason: 'a calculated field cannot reference itself' });
  });
});

describe('parseCalculationConfig — template', () => {
  const referenceable = new Map([
    ['field-company', companyField],
    ['field-calc', calculatedField],
  ]);

  it('accepts a template referencing an existing non-calculated field', () => {
    const result = parseCalculationConfig({
      raw: { kind: 'template', template: '{{field:field-company}} — synthetic' },
      fieldType: 'text',
      ownFieldId: null,
      referenceable,
    });
    expect(result).toEqual({
      ok: true,
      config: { kind: 'template', template: '{{field:field-company}} — synthetic' },
    });
  });

  it('refuses a template on a non-text field', () => {
    const result = parseCalculationConfig({
      raw: { kind: 'template', template: '{{field:field-company}}' },
      fieldType: 'number',
      ownFieldId: null,
      referenceable,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a blank template', () => {
    const result = parseCalculationConfig({
      raw: { kind: 'template', template: '   ' },
      fieldType: 'text',
      ownFieldId: null,
      referenceable,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a template referencing another calculated field', () => {
    const result = parseCalculationConfig({
      raw: { kind: 'template', template: '{{field:field-calc}}' },
      fieldType: 'text',
      ownFieldId: null,
      referenceable,
    });
    expect(result).toEqual({
      ok: false,
      reason: 'a calculated field cannot reference another calculated field',
    });
  });
});

describe('parseCalculationConfig — malformed input', () => {
  it('refuses a non-object raw value', () => {
    expect(
      parseCalculationConfig({
        raw: null,
        fieldType: 'number',
        ownFieldId: null,
        referenceable: new Map(),
      }).ok,
    ).toBe(false);
    expect(
      parseCalculationConfig({
        raw: 'not an object',
        fieldType: 'number',
        ownFieldId: null,
        referenceable: new Map(),
      }).ok,
    ).toBe(false);
  });

  it('refuses an unrecognized kind', () => {
    const result = parseCalculationConfig({
      raw: { kind: 'formula' },
      fieldType: 'number',
      ownFieldId: null,
      referenceable: new Map(),
    });
    expect(result).toEqual({
      ok: false,
      reason: 'calculation kind must be "arithmetic" or "template"',
    });
  });
});

describe('isCalculationConfig', () => {
  it('accepts a well-shaped config and rejects everything else', () => {
    expect(isCalculationConfig({ kind: 'arithmetic' })).toBe(true);
    expect(isCalculationConfig({ kind: 'template' })).toBe(true);
    expect(isCalculationConfig({ kind: 'other' })).toBe(false);
    expect(isCalculationConfig(null)).toBe(false);
    expect(isCalculationConfig('arithmetic')).toBe(false);
    expect(isCalculationConfig(undefined)).toBe(false);
  });
});

describe('computeCalculatedValue — arithmetic', () => {
  it('computes field × constant', () => {
    const value = computeCalculatedValue(
      {
        kind: 'arithmetic',
        left: { type: 'field', fieldId: 'field-revenue' },
        operator: '*',
        right: { type: 'constant', value: 12 },
      },
      { 'field-revenue': 5000 },
    );
    expect(value).toBe(60_000);
  });

  it('computes field - field', () => {
    const value = computeCalculatedValue(
      {
        kind: 'arithmetic',
        left: { type: 'field', fieldId: 'field-revenue' },
        operator: '-',
        right: { type: 'field', fieldId: 'field-cost' },
      },
      { 'field-revenue': 100, 'field-cost': 40 },
    );
    expect(value).toBe(60);
  });

  it('is undefined when an input field is missing', () => {
    const value = computeCalculatedValue(
      {
        kind: 'arithmetic',
        left: { type: 'field', fieldId: 'field-revenue' },
        operator: '*',
        right: { type: 'constant', value: 12 },
      },
      {},
    );
    expect(value).toBeUndefined();
  });

  it('is undefined when an input field holds a non-numeric value', () => {
    const value = computeCalculatedValue(
      {
        kind: 'arithmetic',
        left: { type: 'field', fieldId: 'field-revenue' },
        operator: '*',
        right: { type: 'constant', value: 12 },
      },
      { 'field-revenue': 'not a number' },
    );
    expect(value).toBeUndefined();
  });

  it('is undefined on division by zero rather than Infinity or NaN', () => {
    const value = computeCalculatedValue(
      {
        kind: 'arithmetic',
        left: { type: 'constant', value: 10 },
        operator: '/',
        right: { type: 'constant', value: 0 },
      },
      {},
    );
    expect(value).toBeUndefined();
  });
});

describe('computeCalculatedValue — template', () => {
  it('substitutes referenced field values into the template', () => {
    const value = computeCalculatedValue(
      { kind: 'template', template: '{{field:field-company}} — {{field:field-marketplace}}' },
      { 'field-company': 'Acme', 'field-marketplace': 'Amazon' },
    );
    expect(value).toBe('Acme — Amazon');
  });

  it('substitutes an empty string for a missing reference rather than failing to compute', () => {
    const value = computeCalculatedValue(
      { kind: 'template', template: '{{field:field-company}} — {{field:field-marketplace}}' },
      { 'field-company': 'Acme' },
    );
    expect(value).toBe('Acme — ');
  });
});
