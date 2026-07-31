import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '../../types/domain';
import { defaultFieldValues, toFieldValues } from './schema';

const FIELDS: FieldDefinition[] = [
  { id: 'f1', key: 'company_name', label: 'Company Name', type: 'text' },
  { id: 'f2', key: 'monthly_revenue', label: 'Monthly Revenue', type: 'number' },
  { id: 'f3', key: 'is_priority', label: 'Priority', type: 'boolean' },
];

describe('defaultFieldValues', () => {
  it('stringifies existing non-boolean values and coerces booleans', () => {
    const result = defaultFieldValues(FIELDS, {
      company_name: 'Acme',
      monthly_revenue: 5000,
      is_priority: true,
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
    const result = toFieldValues(FIELDS, {
      company_name: '',
      monthly_revenue: '12000',
      is_priority: true,
    });
    expect(result).toEqual({ monthly_revenue: 12000, is_priority: true });
  });

  it('drops a number field entirely when it fails to parse', () => {
    const result = toFieldValues(FIELDS, {
      company_name: 'Acme',
      monthly_revenue: 'not-a-number',
      is_priority: false,
    });
    expect(result.monthly_revenue).toBeUndefined();
    expect(result.company_name).toBe('Acme');
    expect(result.is_priority).toBe(false);
  });
});
