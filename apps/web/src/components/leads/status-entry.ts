import { ApiError } from '../../lib/api-error';
import type { BehaviorType, Status, StatusEntryExtras } from '../../types/domain';

/**
 * ADR-0026 status rules as the client sees them — shared by every place a
 * status is chosen (Board drag and Move menu, the Seller List's inline
 * control, the Seller 360 record). Everything here keys off a status's
 * *configuration* (its allowed roles, reasons, required fields and engine
 * `behaviorType`), never off a status name.
 */

/** What a status change may carry besides the status itself. */
export interface StatusEntryValues extends StatusEntryExtras {
  /** Required-field values collected on entry, keyed by Field id. */
  fieldValues?: Record<string, unknown> | undefined;
}

/**
 * The engine behaviours whose whole point is a callback date. Entering one
 * prompts for when (D9); every other status offers it as an optional extra.
 */
const FOLLOW_UP_BEHAVIORS: ReadonlySet<BehaviorType> = new Set(['follow_up', 'call_later']);

export function schedulesFollowUp(status: Pick<Status, 'behaviorType'>): boolean {
  return FOLLOW_UP_BEHAVIORS.has(status.behaviorType);
}

/**
 * Whether entering `status` needs a dialog first. A status with none of the
 * ADR-0026 extras configured still changes in one click.
 */
export function needsStatusEntryPrompt(status: Status): boolean {
  return (
    (status.reasonOptions?.length ?? 0) > 0 ||
    (status.requiredFields?.length ?? 0) > 0 ||
    schedulesFollowUp(status)
  );
}

/**
 * Whether the viewer may *choose* this status. Empty allowed roles means
 * anyone, the same default Status Visibility and routing use. Only narrows
 * what the picker offers — the API re-checks every change regardless.
 */
export function canChooseStatus(
  status: Pick<Status, 'allowedRoles'>,
  actor: { roleId: string | undefined; bypass: boolean },
): boolean {
  const allowed = status.allowedRoles ?? [];
  if (allowed.length === 0 || actor.bypass) return true;
  return actor.roleId !== undefined && allowed.some((row) => row.roleId === actor.roleId);
}

/** Why a status change was refused, in terms a caller can act on. */
export type StatusEntryRejection =
  /** Fields the destination needs that are still empty — prompt for them. */
  | { kind: 'missing_fields'; fieldIds: string[] }
  /** The status's allow-list doesn't include the viewer's role. */
  | { kind: 'role_not_allowed' }
  /** Any other 403: the lead itself is out of the viewer's reach. */
  | { kind: 'forbidden' }
  /** A 400 naming no field — the status (or its reasons) changed under us. */
  | { kind: 'stale_status' }
  | { kind: 'other'; error: unknown };

export const ROLE_NOT_ALLOWED_MESSAGE = "Your role can't move leads into this status.";

export function classifyStatusEntryRejection(error: unknown): StatusEntryRejection {
  if (!(error instanceof ApiError)) return { kind: 'other', error };

  if (error.status === 403) {
    // The status allow-list refusal names the status it refused; a scope or
    // grant refusal carries no details at all.
    return typeof error.details?.['statusId'] === 'string'
      ? { kind: 'role_not_allowed' }
      : { kind: 'forbidden' };
  }

  if (error.status === 400 && error.code === 'validation_error') {
    // A transition gate reports every missing Field at once (`fieldIds`); the
    // older "required while in this status" journey-field rule reports only
    // the first (`fieldId`). Both are answered the same way: ask for them.
    const fieldIds = error.details?.['fieldIds'];
    if (Array.isArray(fieldIds)) {
      const ids = fieldIds.filter((id): id is string => typeof id === 'string');
      if (ids.length > 0) return { kind: 'missing_fields', fieldIds: ids };
    }
    const fieldId = error.details?.['fieldId'];
    if (typeof fieldId === 'string') return { kind: 'missing_fields', fieldIds: [fieldId] };
    return { kind: 'stale_status' };
  }

  return { kind: 'other', error };
}

/** Mirrors the API's own `isBlank` for required-field checks. */
export function isBlankValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** A `datetime-local` input's value (local wall time) as an ISO instant. */
export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** An ISO instant as a `datetime-local` value, in the viewer's own time zone. */
export function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** Follow-up due dates carry a time, unlike `formatRelativeDate`. */
export function formatFollowUpDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
