import { describe, expect, it } from 'vitest';

import { resolveFieldDecision } from '../fields.js';

describe('field-level authorization metadata', () => {
  it('treats absent rows as hidden and EDIT as including VIEW', () => {
    const decision = resolveFieldDecision({
      requestedFieldIds: ['field-visible', 'field-editable', 'field-hidden'],
      requestedEditFieldIds: ['field-visible', 'field-editable', 'field-hidden'],
      visibility: [
        { fieldId: 'field-visible', accessLevel: 'VIEW' },
        { fieldId: 'field-editable', accessLevel: 'EDIT' },
      ],
    });

    expect(decision.visibleFieldIds).toEqual(['field-visible', 'field-editable']);
    expect(decision.editableFieldIds).toEqual(['field-editable']);
    expect(decision.strippedFieldIds).toEqual(['field-hidden']);
    expect(decision.rejectedEditFieldIds).toEqual(['field-visible', 'field-hidden']);
  });
});
