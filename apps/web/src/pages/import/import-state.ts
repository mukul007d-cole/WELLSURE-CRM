import type {
  ImportAnalysis,
  ImportColumnTarget,
  ImportMapping,
  ImportMatchKey,
  ImportRowOutcome,
  ImportRunResult,
} from '../../types/domain';

export type ImportStepId = 'upload' | 'map' | 'preview' | 'result';

export const importSteps = [
  { id: 'upload', label: 'Upload' },
  { id: 'map', label: 'Map columns' },
  { id: 'preview', label: 'Preview' },
  { id: 'result', label: 'Result' },
] as const satisfies readonly { id: ImportStepId; label: string }[];

/** A target the admin can pick, flattened for the picker. */
export interface TargetOption {
  /** Stable string identity, so the `<select>` can round-trip a structured target. */
  value: string;
  label: string;
  group: string;
  target: ImportColumnTarget;
}

export function targetValue(target: ImportColumnTarget): string {
  switch (target.kind) {
    case 'skip':
      return 'skip';
    case 'core':
      return `core:${target.column}`;
    case 'field':
      return `field:${target.fieldId}`;
    case 'assignment':
      return `assignment:${target.assignmentType}`;
    case 'status':
      return 'status';
  }
}

export function buildTargetOptions(input: {
  fields: readonly { id: string; label: string }[];
  assignmentTypes: readonly string[];
}): TargetOption[] {
  const option = (target: ImportColumnTarget, label: string, group: string): TargetOption => ({
    value: targetValue(target),
    label,
    group,
    target,
  });
  return [
    option({ kind: 'skip' }, "Don't import", 'Skip'),
    option({ kind: 'core', column: 'name' }, 'Name', 'Lead details'),
    option({ kind: 'core', column: 'phone' }, 'Phone', 'Lead details'),
    option({ kind: 'core', column: 'email' }, 'Email', 'Lead details'),
    option({ kind: 'status' }, 'Status (by name)', 'Lead details'),
    ...input.fields.map((field) =>
      option({ kind: 'field', fieldId: field.id }, field.label, 'Fields'),
    ),
    ...input.assignmentTypes.map((assignmentType) =>
      option({ kind: 'assignment', assignmentType }, assignmentType, 'Assign by email'),
    ),
  ];
}

/**
 * Every column starts as `skip`.
 *
 * Not "unset", and not guessed from the column's name. A header called `email`
 * is *probably* the email, and guessing it is exactly what this feature is
 * required not to do — the admin decides, and the UI shows how many columns
 * they have decided to leave out so the decision stays visible.
 */
export function initialColumnTargets(analysis: ImportAnalysis): Record<string, ImportColumnTarget> {
  return Object.fromEntries(analysis.columns.map((column) => [column.name, { kind: 'skip' }]));
}

export function mappedCount(columns: Record<string, ImportColumnTarget>): number {
  return Object.values(columns).filter((target) => target.kind !== 'skip').length;
}

/** Which targets are already spoken for, so the picker can mark them taken. */
export function claimedTargets(
  columns: Record<string, ImportColumnTarget>,
  exceptColumn: string,
): Set<string> {
  const claimed = new Set<string>();
  for (const [column, target] of Object.entries(columns)) {
    if (column === exceptColumn || target.kind === 'skip') continue;
    claimed.add(targetValue(target));
  }
  return claimed;
}

/** Match keys the admin may choose: only targets some column actually writes. */
export function availableMatchKeys(
  columns: Record<string, ImportColumnTarget>,
  fields: readonly { id: string; label: string }[],
): { key: ImportMatchKey; label: string }[] {
  const labels = new Map(fields.map((field) => [field.id, field.label]));
  const keys: { key: ImportMatchKey; label: string }[] = [];
  for (const target of Object.values(columns)) {
    if (target.kind === 'core' && target.column !== 'name') {
      keys.push({ key: { kind: 'core', column: target.column }, label: capitalize(target.column) });
    }
    if (target.kind === 'core' && target.column === 'name') {
      keys.push({ key: { kind: 'core', column: 'name' }, label: 'Name' });
    }
    if (target.kind === 'field') {
      keys.push({
        key: { kind: 'field', fieldId: target.fieldId },
        label: labels.get(target.fieldId) ?? 'Field',
      });
    }
  }
  return keys;
}

export function matchKeyValue(key: ImportMatchKey): string {
  return key.kind === 'core' ? `core:${key.column}` : `field:${key.fieldId}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export interface MappingDraft {
  journeyId: string;
  statusId: string;
  assignmentType: string;
  assignmentUserId: string;
  columns: Record<string, ImportColumnTarget>;
  matchKeys: ImportMatchKey[];
}

/**
 * What is still missing before a preview can run.
 *
 * Mirrors the server's own file-level checks so the admin is told in the UI
 * rather than by a 400 — but the server remains the judge, and re-runs every
 * one of these. This is a courtesy, not an authority.
 */
export function mappingProblems(draft: MappingDraft): string[] {
  const problems: string[] = [];
  if (draft.journeyId === '') problems.push('Choose the journey these leads belong to.');
  const targets = Object.values(draft.columns);
  if (!targets.some((target) => target.kind === 'core' && target.column === 'name')) {
    problems.push('Map one column to the lead name — every lead needs one.');
  }
  const hasRowOwner = targets.some((target) => target.kind === 'assignment');
  const hasFileOwner = draft.assignmentType.trim() !== '' && draft.assignmentUserId !== '';
  if (!hasRowOwner && !hasFileOwner) {
    problems.push('Choose who will own these leads, or map a column of owner email addresses.');
  }
  const seen = new Map<string, string>();
  for (const [column, target] of Object.entries(draft.columns)) {
    if (target.kind === 'skip') continue;
    const value = targetValue(target);
    const existing = seen.get(value);
    if (existing !== undefined) {
      problems.push(`“${column}” and “${existing}” are both mapped to the same thing.`);
    }
    seen.set(value, column);
  }
  return problems;
}

export function toMapping(draft: MappingDraft): ImportMapping {
  const assignments =
    draft.assignmentType.trim() !== '' && draft.assignmentUserId !== ''
      ? [{ assignmentType: draft.assignmentType.trim(), userId: draft.assignmentUserId }]
      : [];
  return {
    journeyId: draft.journeyId,
    ...(draft.statusId === '' ? {} : { statusId: draft.statusId }),
    assignments,
    columns: draft.columns,
    matchKeys: draft.matchKeys,
  };
}

export interface ErrorGroup {
  reason: string;
  rows: ImportRowOutcome[];
}

/**
 * Rejections grouped by why, biggest first.
 *
 * A preview of a 4,000-row file can hold 300 rejections for six distinct
 * reasons. Listing 300 rows is a wall of text; "Required field missing:
 * Company — 214 rows" is a thing you can go and fix.
 */
export function groupErrors(rows: readonly ImportRowOutcome[]): ErrorGroup[] {
  const groups = new Map<string, ImportRowOutcome[]>();
  for (const row of rows) {
    if (row.outcome !== 'rejected') continue;
    const reason = row.reason ?? 'Rejected';
    const existing = groups.get(reason);
    if (existing) existing.push(row);
    else groups.set(reason, [row]);
  }
  return [...groups.entries()]
    .map(([reason, grouped]) => ({ reason, rows: grouped }))
    .sort((left, right) => right.rows.length - left.rows.length);
}

export function outcomeCounts(result: ImportRunResult) {
  return [
    {
      id: 'created' as const,
      label: 'Will be created',
      count: result.createdCount,
      tone: 'won' as const,
    },
    {
      id: 'skipped_duplicate' as const,
      label: 'Skipped as duplicates',
      count: result.skippedCount,
      tone: 'open' as const,
    },
    {
      id: 'rejected' as const,
      label: 'Cannot be imported',
      count: result.rejectedCount,
      tone: 'lost' as const,
    },
  ];
}
