import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '../../types/domain';
import { DetailsTab } from './DetailsTab';

const fields: FieldDefinition[] = [
  {
    id: 'field-multi',
    key: 'synthetic_multi',
    label: 'Synthetic Multi',
    type: 'multi_select',
    options: ['Option A', 'Option B', 'Option C'],
    editMode: 'manual',
  },
  {
    id: 'field-datetime',
    key: 'synthetic_datetime',
    label: 'Synthetic Datetime',
    type: 'datetime',
    editMode: 'manual',
  },
  {
    id: 'field-empty-multi',
    key: 'synthetic_empty_multi',
    label: 'Synthetic Empty Multi',
    type: 'multi_select',
    editMode: 'manual',
  },
];

describe('DetailsTab', () => {
  it('lists a multi-select value as text and a datetime as a local date and time', () => {
    const instant = '2026-03-04T10:30:00.000Z';
    render(
      <DetailsTab
        fields={fields}
        fieldValues={{
          'field-multi': ['Option A', 'Option C'],
          'field-datetime': instant,
          'field-empty-multi': [],
        }}
        isPending={false}
      />,
    );

    expect(screen.getByText('Option A, Option C')).toBeInTheDocument();
    const expected = new Date(instant).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(instant)).not.toBeInTheDocument();
    // An emptied list reads as no value, like a blank text Field.
    expect(screen.getByText('Synthetic Empty Multi').nextElementSibling).toHaveTextContent('—');
  });

  it('shows a malformed datetime as stored rather than "Invalid Date"', () => {
    render(
      <DetailsTab
        fields={fields}
        fieldValues={{ 'field-datetime': 'not-a-date' }}
        isPending={false}
      />,
    );
    expect(screen.getByText('not-a-date')).toBeInTheDocument();
  });
});
