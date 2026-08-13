/**
 * One place decides that a persisted activity is a trigger.
 *
 * Phase 9 read this classification inline and handed it to the notification
 * rules. Campaigns need the same signal — "a lead entered status X" — so the
 * classification moved here and fans out to both consumers instead of being
 * written twice. Phase 14b's routing rules are the third consumer. No consumer
 * knows about any other.
 *
 * What is deliberately *not* shared is the rule row. Notification rules resolve
 * which **users** to notify; a campaign emails the **lead**; a routing rule
 * assigns the lead to someone. They are different universes, and merging them
 * would mean a rule table where most columns are meaningless for any one branch.
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

export interface TriggerConsumer {
  evaluate(event: TriggerEvent): Promise<void>;
}

/**
 * The consumer list, in one place.
 *
 * ADR-0013 said a third consumer would be "a registration rather than another
 * copy of the classification". Collecting that promise meant the list had to
 * stop living in two places: `writeActivity` knew both consumers, while
 * `LeadSharingService.reassign` knew only notifications — so a manual
 * reassignment reached Notification Rules and never reached campaign triggers.
 * That was invisible only because campaigns ignore everything except
 * `status_changed`. Every writer now dispatches here instead.
 *
 * Consumers run in order, inside the caller's transaction, and a throw
 * propagates — Phase 9's rollback guarantee depends on that and is unchanged.
 *
 * Termination: routing writes a `reassignment` activity, which dispatches
 * `lead_reassigned`, which routing ignores. One hop. A fourth consumer that
 * writes a *status change* in response to a trigger would reopen this question,
 * which is why `phase14b` asserts the hop count rather than trusting the
 * argument.
 */
export class TriggerDispatcher {
  private readonly consumers: readonly TriggerConsumer[];

  constructor(consumers: readonly (TriggerConsumer | undefined)[]) {
    this.consumers = consumers.filter((c): c is TriggerConsumer => c !== undefined);
  }

  async dispatch(event: TriggerEvent): Promise<void> {
    for (const consumer of this.consumers) await consumer.evaluate(event);
  }
}
