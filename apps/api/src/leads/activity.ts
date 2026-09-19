export interface LeadActivityInput {
  organizationId: string;
  leadId: string;
  processInstanceId?: string | null;
  actorUserId: string;
  actionType:
    | 'comment'
    | 'field_edit'
    | 'status_change'
    | 'reassignment'
    | 'share_changed'
    | 'lead_deactivated'
    // A process instance moved to a different journey.
    | 'journey_change';
  source: string;
  oldValue: unknown;
  newValue: unknown;
  /**
   * The Field ids this specific write actually touched — only meaningful
   * (and only ever supplied) for `actionType: 'field_edit'`. Lets a
   * `field_edited` Notification Rule's `scope.fieldId` filter on the field
   * that changed instead of firing for every edit to every field.
   */
  changedFieldIds?: readonly string[];
}

export interface LeadActivityWriter {
  writeActivity(input: LeadActivityInput): Promise<void>;
}
