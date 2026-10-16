import type { ActivityEntry } from '../../types/domain';

/**
 * What a `follow_up` activity row says (ADR-0026, D9). The API writes two
 * shapes into `newValue`: a schedule — `{taskId, dueAt, note?,
 * assignedToUserId}`, from a status change, "Schedule follow-up" or a
 * reschedule (whose `oldValue` then carries the previous `dueAt`) — and a
 * state change — `{taskId, status, note?}` for done, cancelled or reopened.
 * Keyed off the engine's task states only, never configuration.
 */
export type FollowUpEntry =
  | {
      kind: 'scheduled';
      dueAt: string;
      /** Set when this replaced an earlier due time (a reschedule). */
      previousDueAt: string | null;
      note: string | null;
      assignedToUserId: string | null;
    }
  | { kind: 'done' | 'cancelled' | 'reopened'; note: string | null };

const STATE_KIND: Record<string, 'done' | 'cancelled' | 'reopened'> = {
  done: 'done',
  cancelled: 'cancelled',
  open: 'reopened',
};

const VERB: Record<FollowUpEntry['kind'], string> = {
  scheduled: 'scheduled a follow-up',
  done: 'completed a follow-up',
  cancelled: 'cancelled a follow-up',
  reopened: 'reopened a follow-up',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** Null for any other action type, or a payload this client doesn't know. */
export function followUpEntry(
  entry: Pick<ActivityEntry, 'actionType' | 'oldValue' | 'newValue'>,
): FollowUpEntry | null {
  if (entry.actionType !== 'follow_up') return null;
  const after = asRecord(entry.newValue);
  if (!after) return null;
  const note = text(after['note']);

  const dueAt = text(after['dueAt']);
  if (dueAt) {
    return {
      kind: 'scheduled',
      dueAt,
      // Only a reschedule names the old task's due time; scheduling over an
      // open follow-up records just how many it closed.
      previousDueAt: text(asRecord(entry.oldValue)?.['dueAt']),
      note,
      assignedToUserId: text(after['assignedToUserId']),
    };
  }

  const kind = STATE_KIND[String(after['status'])];
  return kind ? { kind, note } : null;
}

export function followUpVerb(entry: FollowUpEntry): string {
  return entry.kind === 'scheduled' && entry.previousDueAt
    ? 'rescheduled a follow-up'
    : VERB[entry.kind];
}
