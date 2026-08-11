/**
 * One place decides that a persisted activity is a trigger.
 *
 * Phase 9 read this classification inline and handed it to the notification
 * rules. Campaigns need the same signal — "a lead entered status X" — so the
 * classification moved here and fans out to both consumers instead of being
 * written twice. Neither consumer knows about the other.
 *
 * What is deliberately *not* shared is the rule row. Notification rules resolve
 * which **users** to notify; a campaign emails the **lead**. They are different
 * recipient universes, and merging them would mean a rule table where half the
 * columns are meaningless for either branch.
 */

export type TriggerType =
  'field_edited' | 'status_changed' | 'lead_reassigned' | 'lead_deactivated';

export interface TriggerEvent {
  organizationId: string;
  activityLogId: string;
  leadId: string;
  processInstanceId?: string | null;
  actorUserId: string;
  triggerType: TriggerType;
  oldValue?: unknown;
  /**
   * Phase 9 never needed this; a campaign keyed on *entering* a status reads
   * the new status id from it.
   */
  newValue?: unknown;
}

export function triggerTypeFor(actionType: string): TriggerType | undefined {
  switch (actionType) {
    case 'field_edit':
      return 'field_edited';
    case 'status_change':
      return 'status_changed';
    case 'reassignment':
      return 'lead_reassigned';
    case 'lead_deactivated':
      return 'lead_deactivated';
    default:
      return undefined;
  }
}

/** The status a `status_changed` activity moved the process instance into. */
export function enteredStatusId(newValue: unknown): string | null {
  if (typeof newValue !== 'object' || newValue === null) return null;
  const statusId = (newValue as { statusId?: unknown }).statusId;
  return typeof statusId === 'string' ? statusId : null;
}
