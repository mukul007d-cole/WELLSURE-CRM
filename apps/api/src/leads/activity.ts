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
    | 'lead_deactivated';
  source: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface LeadActivityWriter {
  writeActivity(input: LeadActivityInput): Promise<void>;
}
