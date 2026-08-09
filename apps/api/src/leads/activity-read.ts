import type { LeadActivityInput } from './activity.js';

export type LeadActivityActionType = LeadActivityInput['actionType'];

/** One `activity_logs` row as stored, with the actor joined. */
export interface LeadActivityRow {
  id: string;
  processInstanceId: string | null;
  actorUserId: string | null;
  actor?: { id: string; name: string } | null;
  timestamp: Date;
  actionType: string;
  source: string;
  commentText: string | null;
  oldValue: unknown;
  newValue: unknown;
}

/** What the timeline endpoint returns for one row. */
export interface LeadActivityEntry {
  id: string;
  processInstanceId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  timestamp: string;
  actionType: string;
  source: string;
  commentText: string | null;
  oldValue: unknown;
  newValue: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Drop the dynamic fields a viewer isn't entitled to.
 *
 * Shared by the Seller 360 serializer and the activity timeline, so a field
 * hidden on the record can't reappear in its history.
 */
export function pickVisibleFieldValues(
  fieldValues: Record<string, unknown>,
  visibleFieldIds: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fieldValues).filter(([fieldId]) => visibleFieldIds.has(fieldId)),
  );
}

/**
 * Activity payloads are whole-lead snapshots — `editLead` stores the entire
 * record on both sides of a change. Nothing filtered them before because
 * nothing read them; serving them raw would turn history into a way to read
 * fields the viewer is denied on the record itself.
 *
 * Keyed off the payload's shape rather than the row's `actionType`: today only
 * `field_edit` carries field values, but a writer that starts attaching them to
 * some other action gets redacted automatically rather than leaking until
 * someone notices.
 */
export function redactSnapshot(value: unknown, visibleFieldIds: ReadonlySet<string>): unknown {
  if (!isPlainObject(value)) return value;
  const fieldValues = value['fieldValues'];
  if (!isPlainObject(fieldValues)) return value;
  return { ...value, fieldValues: pickVisibleFieldValues(fieldValues, visibleFieldIds) };
}

export function serializeActivityEntry(
  row: LeadActivityRow,
  visibleFieldIds: ReadonlySet<string>,
): LeadActivityEntry {
  return {
    id: row.id,
    processInstanceId: row.processInstanceId,
    actorUserId: row.actorUserId,
    // Null for system-authored rows, so the client says "System" rather than
    // rendering a blank or a raw id.
    actorName: row.actor?.name ?? null,
    timestamp: row.timestamp.toISOString(),
    actionType: row.actionType,
    source: row.source,
    commentText: row.commentText,
    oldValue: redactSnapshot(row.oldValue, visibleFieldIds),
    newValue: redactSnapshot(row.newValue, visibleFieldIds),
  };
}
