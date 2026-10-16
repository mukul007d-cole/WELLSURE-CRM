import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FieldDefinition } from '../../types/domain';
import { FilterBuilder } from './FilterBuilder';
import type { FilterCondition } from './filter-state';

const fields: FieldDefinition[] = [
  {
    id: 'field-multi',
    key: 'synthetic_multi',
    label: 'Synthetic Multi',
    type: 'multi_select',
    options: ['Option A', 'Option B'],
    editMode: 'manual',
  },
  {
    id: 'field-datetime',
    key: 'synthetic_datetime',
    label: 'Synthetic Datetime',
    type: 'datetime',
    editMode: 'manual',
  },
];

function renderBuilder(conditions: FilterCondition[]) {
  return render(
    <FilterBuilder
      conditions={conditions}
      onChange={vi.fn()}
      fields={fields}
      statuses={[]}
      journeys={[]}
    />,
  );
}

describe('FilterBuilder', () => {
  it('offers both new field types as filter targets', () => {
    renderBuilder([
      { target: { kind: 'core', column: 'name' }, operator: 'contains', values: [''] },
    ]);
    expect(screen.getByRole('option', { name: 'Synthetic Multi' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Synthetic Datetime' })).toBeInTheDocument();
  });

  it('picks a multi-select value from the Field’s own options, with presence checks too', () => {
    renderBuilder([
      { target: { kind: 'field', fieldId: 'field-multi' }, operator: 'in', values: [''] },
    ]);
    const operator = screen.getByLabelText('Condition 1 operator');
    expect(Array.from(operator.querySelectorAll('option')).map((option) => option.value)).toEqual([
      'in',
      'not_in',
      'is_empty',
      'is_not_empty',
    ]);
    const value = screen.getByLabelText('Condition 1 value');
    expect(value.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Option B' })).toBeInTheDocument();
  });

  it('asks for calendar days on a datetime Field, not instants', () => {
    renderBuilder([
      {
        target: { kind: 'field', fieldId: 'field-datetime' },
        operator: 'between',
        values: ['', ''],
      },
    ]);
    expect(screen.getByLabelText('Condition 1 value 1')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Condition 1 value 2')).toHaveAttribute('type', 'date');
  });
});
