import type { FieldDecision, FieldVisibilitySnapshot } from './types.js';

export function resolveFieldDecision(input: {
  requestedFieldIds: readonly string[];
  requestedEditFieldIds: readonly string[];
  visibility: readonly FieldVisibilitySnapshot[];
}): FieldDecision {
  const visible = new Set<string>();
  const editable = new Set<string>();

  for (const row of input.visibility) {
    visible.add(row.fieldId);
    if (row.accessLevel === 'EDIT') {
      editable.add(row.fieldId);
    }
  }

  const visibleFieldIds = input.requestedFieldIds.filter((fieldId) => visible.has(fieldId));
  const editableFieldIds = input.requestedEditFieldIds.filter((fieldId) => editable.has(fieldId));

  return {
    visibleFieldIds,
    editableFieldIds,
    strippedFieldIds: input.requestedFieldIds.filter((fieldId) => !visible.has(fieldId)),
    rejectedEditFieldIds: input.requestedEditFieldIds.filter((fieldId) => !editable.has(fieldId)),
  };
}
