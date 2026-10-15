import type { Status, StatusColor } from '../../../types/domain';

/**
 * The Status editor's draft, and the requests built from it. Two endpoints:
 * the Status itself (name, order, types, color, reasons) and its ADR-0026
 * rules, which `PUT /statuses/:id/rules` replaces as one set.
 */
export type StatusDraft = {
  id?: string;
  key?: string;
  name: string;
  outcomeType: string;
  behaviorType: string;
  sortOrder: number;
  color: StatusColor | null;
  reasonOptions: string[];
  /** ADR-0026 status rules — saved through their own endpoint, see `rulesChanged`. */
  allowedRoleIds: string[];
  requiredFieldIds: string[];
};

export function newStatusDraft(sortOrder: number): StatusDraft {
  return {
    name: '',
    outcomeType: 'open',
    behaviorType: 'default',
    sortOrder,
    color: null,
    reasonOptions: [],
    allowedRoleIds: [],
    requiredFieldIds: [],
  };
}

export function fromStatus(status: Status): StatusDraft {
  return {
    id: status.id,
    key: status.key,
    name: status.name,
    outcomeType: status.outcomeType,
    behaviorType: status.behaviorType,
    sortOrder: status.sortOrder,
    color: status.color ?? null,
    reasonOptions: status.reasonOptions ?? [],
    allowedRoleIds: (status.allowedRoles ?? []).map((row) => row.roleId),
    requiredFieldIds: (status.requiredFields ?? []).map((row) => row.fieldId),
  };
}

/** What PATCH /statuses/:id and POST /journeys/:id/statuses take. */
export function statusBody(draft: StatusDraft) {
  return {
    name: draft.name,
    outcomeType: draft.outcomeType,
    behaviorType: draft.behaviorType,
    sortOrder: draft.sortOrder,
    color: draft.color,
    reasonOptions: draft.reasonOptions,
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * Whether the rules need a PUT. The endpoint is a full replace that writes an
 * audit row, so an edit that only renamed the Status must not send one.
 */
export function rulesChanged(draft: StatusDraft, stored: Status | undefined): boolean {
  const before = stored
    ? fromStatus(stored)
    : { allowedRoleIds: [] as string[], requiredFieldIds: [] as string[] };
  return (
    !sameSet(draft.allowedRoleIds, before.allowedRoleIds) ||
    !sameSet(draft.requiredFieldIds, before.requiredFieldIds)
  );
}
