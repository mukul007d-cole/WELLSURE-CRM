export type ConfigurationAuditEntityType =
  | 'journey'
  | 'status'
  | 'service'
  | 'field'
  | 'journey_service'
  | 'field_journey_setting'
  | 'field_visibility'
  // ADR-0026 — a Status's allowed roles and required-to-enter Fields.
  | 'status_rules';

export type ConfigurationAuditAction =
  'create' | 'edit' | 'reorder' | 'deactivate' | 'delete' | 'reassign_and_deactivate';

export interface ConfigurationAuditInput {
  organizationId: string;
  actorUserId: string;
  entityType: ConfigurationAuditEntityType;
  entityId: string;
  action: ConfigurationAuditAction;
  oldValue: unknown;
  newValue: unknown;
}

export interface ConfigurationAuditWriter {
  writeSystemAudit(input: ConfigurationAuditInput): Promise<void>;
}

export interface LeadActivityInput {
  organizationId: string;
  leadId: string;
  processInstanceId: string;
  actorUserId: string;
  actionType: 'status_change';
  source: 'configuration_engine';
  oldValue: unknown;
  newValue: unknown;
}

export interface LeadActivityWriter {
  writeActivity(input: LeadActivityInput): Promise<void>;
}
