import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '../types/domain';
import { groupFieldsBySection } from './field-sections';

function field(overrides: Partial<FieldDefinition> & { id: string }): FieldDefinition {
  return {
    key: overrides.id,
    label: overrides.id,
    type: 'text',
    editMode: 'manual',
    ...overrides,
  };
}

describe('groupFieldsBySection', () => {
  it('groups fields under their configured section, in first-appearance order', () => {
    const fields = [
      field({ id: 'a', section: 'Company' }),
      field({ id: 'b', section: 'Contact' }),
      field({ id: 'c', section: 'Company' }),
    ];
    const sections = groupFieldsBySection(fields);
    expect(sections.map((section) => section.name)).toEqual(['Company', 'Contact']);
    expect(sections[0]?.fields.map((f) => f.id)).toEqual(['a', 'c']);
    expect(sections[1]?.fields.map((f) => f.id)).toEqual(['b']);
  });

  it('puts unsectioned fields last, under a neutral heading', () => {
    const fields = [field({ id: 'a', section: null }), field({ id: 'b', section: 'Company' })];
    const sections = groupFieldsBySection(fields);
    expect(sections.map((section) => section.name)).toEqual(['Company', 'Other details']);
  });

  it('defaults to including every field when no predicate is given', () => {
    const fields = [field({ id: 'a' }), field({ id: 'b' })];
    const sections = groupFieldsBySection(fields);
    expect(sections[0]?.fields).toHaveLength(2);
  });

  it('applies the include predicate — the read-only view can ask for only fields with a value', () => {
    const fields = [field({ id: 'a' }), field({ id: 'b' })];
    const fieldValues = { a: 'present' };
    const sections = groupFieldsBySection(fields, (f) => f.id in fieldValues);
    expect(sections[0]?.fields.map((f) => f.id)).toEqual(['a']);
  });

  it('returns no sections when every field is excluded', () => {
    expect(groupFieldsBySection([field({ id: 'a' })], () => false)).toEqual([]);
  });
});
