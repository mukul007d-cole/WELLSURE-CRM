export type SecurityAuditAction =
  | 'auth.login_failed'
  | 'auth.lockout_created'
  | 'auth.password_reset_requested'
  | 'auth.password_reset_completed'
  | 'auth.session_revoked';

export interface SecurityAuditInput {
  organizationId: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: SecurityAuditAction;
  oldValue: unknown;
  newValue: unknown;
}

export interface SecurityAuditWriter {
  writeSystemAudit(input: SecurityAuditInput): Promise<void>;
}
