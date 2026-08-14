import type { ActivityEntry, FieldDefinition } from '../../types/domain';

export type ActivityTone = 'neutral' | 'edit' | 'status' | 'people' | 'removed';

/**
 * How one activity row reads.
 *
 * Keyed off the engine's `actionType` enum only. A status, journey, role or
 * field *name* never appears in this table — those are admin configuration and
 * get resolved at render time from the same config queries the rest of the app
 * uses. Same rule `statusTone` follows for colour.
 */
const ENTRY_COPY: Record<string, { verb: string; tone: ActivityTone }> = {
  comment: { verb: 'commented', tone: 'neutral' },
  field_edit: { verb: 'updated this seller', tone: 'edit' },
  status_change: { verb: 'moved the status', tone: 'status' },
  reassignment: { verb: 'reassigned this seller', tone: 'people' },
  share_changed: { verb: 'changed who this is shared with', tone: 'people' },
  lead_deactivated: { verb: 'deactivated this seller', tone: 'removed' },
};

const UNKNOWN = { verb: 'made a change', tone: 'neutral' as const };

/** Falls back rather than throwing: `action_type` is a plain column, not a DB enum. */
export function entryCopy(actionType: string): { verb: string; tone: ActivityTone } {
  return ENTRY_COPY[actionType] ?? UNKNOWN;
}

export const TONE_CLASSES: Record<ActivityTone, string> = {
  neutral: 'bg-surface-sunken text-ink-soft',
  edit: 'bg-status-followup-bg text-status-followup',
  status: 'bg-status-open-bg text-status-open',
  people: 'bg-gold-soft text-gold-foreground',
  removed: 'bg-status-lost-bg text-status-lost',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fieldValuesOf(snapshot: unknown): Record<string, unknown> {
  const record = asRecord(snapshot);
  return record ? (asRecord(record['fieldValues']) ?? {}) : {};
}

export interface FieldChange {
  /** The field's id, or its key on older rows — whichever the snapshot used. */
  fieldId: string;
  label: string | null;
  from: unknown;
  to: unknown;
}

/**
 * What actually changed between two snapshots.
 *
 * `editLead` stores the whole lead on both sides, so rendering the raw payload
 * would list every field on every entry. Only keys whose value differs are
 * returned. The server has already dropped the fields this viewer can't see,
 * so anything missing here is missing on purpose.
 */
export function fieldChanges(
  entry: Pick<ActivityEntry, 'oldValue' | 'newValue'>,
  fields: readonly FieldDefinition[],
): FieldChange[] {
  const before = fieldValuesOf(entry.oldValue);
  const after = fieldValuesOf(entry.newValue);
  const byId = new Map(fields.map((field) => [field.id, field.label]));
  const byKey = new Map(fields.map((field) => [field.key, field.label]));

  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({
      fieldId: key,
      // Null rather than the raw id: a viewer without `fields:view` gets no
      // config to resolve against, and a UUID on screen helps nobody.
      label: byId.get(key) ?? byKey.get(key) ?? null,
      from: before[key],
      to: after[key],
    }));
}

export interface ReassignmentParties {
  assignmentType: string | null;
  from: string | null;
  to: string | null;
}

/**
 * Who a reassignment moved the lead between.
 *
 * The activity payload stores user ids only, and there is no batch by-ids
 * endpoint, so names are resolved against the paged directory the app already
 * caches. A viewer without `users:view` has no directory — they get null, which
 * the renderer turns into "another user" rather than a raw UUID.
 */
export function reassignmentParties(
  entry: Pick<ActivityEntry, 'actionType' | 'oldValue' | 'newValue'>,
  directory: ReadonlyMap<string, string>,
): ReassignmentParties | null {
  if (entry.actionType !== 'reassignment') return null;
  const before = asRecord(entry.oldValue);
  const after = asRecord(entry.newValue);
  if (!before && !after) return null;
  const name = (value: unknown) =>
    typeof value === 'string' ? (directory.get(value) ?? null) : null;
  const type = after?.['assignmentType'] ?? before?.['assignmentType'];
  return {
    assignmentType: typeof type === 'string' ? type : null,
    from: name(before?.['userId']),
    to: name(after?.['userId']),
  };
}

/** Whether the two snapshots differ only in ways this viewer cannot see. */
export function hasRedactedChanges(
  entry: Pick<ActivityEntry, 'actionType' | 'oldValue' | 'newValue'>,
  changes: readonly FieldChange[],
): boolean {
  if (entry.actionType !== 'field_edit' || changes.length > 0) return false;
  // A field_edit that produced no visible diff is one whose changed fields were
  // all redacted — say a change happened rather than render an empty entry.
  return true;
}
