export interface LeadActivityInput {
  organizationId: string;
  leadId: string;
  processInstanceId?: string | null;
  actorUserId: string;
  actionType: 'field_edit' | 'status_change' | 'reassignment';
  source: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface LeadActivityWriter {
  writeActivity(input: LeadActivityInput): Promise<void>;
}
