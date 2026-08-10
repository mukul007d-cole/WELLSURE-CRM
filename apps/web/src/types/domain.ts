/**
 * Mirrors packages/permission-engine/src/types.ts and the Prisma schema enums
 * verbatim. Keep in sync with the backend — this is not a hypothetical shape.
 */

export type DataScope = 'SELF' | 'TEAM' | 'DEPARTMENT' | 'ORGANIZATION';
export type FieldAccessLevel = 'VIEW' | 'EDIT';
export type OutcomeType = 'open' | 'closed_won' | 'closed_lost';
export type BehaviorType = 'default' | 'call_later' | 'follow_up' | 'archived';

export type FieldType =
  'text' | 'textarea' | 'email' | 'phone' | 'date' | 'select' | 'number' | 'boolean' | 'json';

export type FieldRequirement = 'required' | 'optional' | 'hidden';

export interface Journey {
  id: string;
  key: string;
  name: string;
  isActive: boolean;
}

/** Assignment types in use on a Journey — configurable strings, never an enum. */
export type JourneyAssignmentTypes = readonly string[];

export interface Status {
  id: string;
  journeyId: string;
  key: string;
  name: string;
  outcomeType: OutcomeType;
  behaviorType: BehaviorType;
  isActive: boolean;
  sortOrder: number;
  /**
   * Creating a Lead without an explicit statusId falls back to the Journey's
   * default-on-create Status. If no Status carries this flag that fallback
   * fails, so the client has to know whether one exists.
   */
  isDefaultOnCreate: boolean;
}

/**
 * What POST /leads and PATCH /leads/:id actually return: the raw lead and
 * process-instance rows, not a serialized Seller360Record. Only the fields
 * consumers rely on are declared.
 */
export interface LeadMutationResult {
  lead: { id: string; name: string };
  process: { id: string; journeyId: string; currentStatusId: string };
}

export interface Service {
  id: string;
  key: string;
  name: string;
  isActive: boolean;
}

export interface FieldValidationRule {
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

export interface FieldDefinition {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  options?: readonly string[];
  validationRule?: FieldValidationRule;
  /**
   * Administrator-configured grouping, e.g. the sections a record's details are
   * split into. Already served by the configuration API; this type just never
   * declared it, so the value was on the wire and unused.
   */
  section?: string | null;
}

export interface JourneyFieldSetting {
  fieldId: string;
  journeyId: string;
  requirement: FieldRequirement;
  requiredFromStatusId?: string | null;
  access: FieldAccessLevel;
}

export interface LeadProcessRecord {
  processInstanceId: string;
  journeyId: string;
  active: boolean;
}

export interface LeadAssignmentRecord {
  id: string;
  assignmentType: string;
  userId: string;
  userName: string;
}

/** Response shape of serializeLead() — identical for list rows and detail. */
export interface LeadCoreRecord {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  fieldValues: Record<string, unknown>;
}

export interface SellerListRow extends LeadCoreRecord {
  shared?: boolean;
  processInstances?: Array<{
    processInstanceId: string;
    journeyId: string;
    journeyName: string;
    statusId: string;
    statusName: string;
    statusOutcomeType: OutcomeType;
    statusBehaviorType: BehaviorType;
    ownerName: string | null;
  }>;
}

export interface Seller360ProcessInstance extends LeadProcessRecord {
  assignments: LeadAssignmentRecord[];
  journey: { id: string; key: string; name: string };
  currentStatus: {
    id: string;
    key: string;
    name: string;
    outcomeType: OutcomeType;
    behaviorType: BehaviorType;
  };
}

export interface Seller360Record extends LeadCoreRecord {
  processInstances: Seller360ProcessInstance[];
}

export interface SellerListInput {
  search?: string | undefined;
  journeyId?: string | undefined;
  statusId?: string | undefined;
  ownerUserId?: string | undefined;
  sortBy?: 'createdAt' | 'updatedAt' | 'name' | undefined;
  sortDirection?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  accessMode?: 'mine' | 'shared_with_me' | 'all';
}

/**
 * The engine's closed set of activity kinds. The timeline keys its icon and
 * phrasing off these, never off a status, journey or role name — same
 * discipline `statusTone` follows for colour.
 */
export type ActivityActionType =
  | 'comment'
  | 'field_edit'
  | 'status_change'
  | 'reassignment'
  | 'share_changed'
  | 'lead_deactivated';

export interface ActivityEntry {
  id: string;
  processInstanceId: string | null;
  actorUserId: string | null;
  /** Null for system-authored rows. */
  actorName: string | null;
  timestamp: string;
  /**
   * Normally an `ActivityActionType`, but `action_type` is a plain text column
   * rather than a DB enum, so the renderer falls back instead of narrowing.
   */
  actionType: string;
  source: string;
  commentText: string | null;
  /** Whole-lead snapshots, already redacted server-side to visible fields. */
  oldValue: unknown;
  newValue: unknown;
}

export interface AttachmentRecord {
  id: string;
  leadId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedById: string;
  uploadedByName: string | null;
  uploadedAt: string;
}

export type ShareCapability = 'view' | 'edit' | 'comment';
export interface LeadShare {
  id: string;
  userId: string;
  userName: string;
  grantedByUserId: string;
  capabilities: ShareCapability[];
  createdAt: string;
}
export interface NotificationItem {
  id: string;
  type: string;
  message: string;
  referenceLeadId: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}
export interface NotificationRuleRecipient {
  resolverType: string;
  parameters: Record<string, unknown>;
  sortOrder: number;
}
export interface NotificationRule {
  id: string;
  key: string;
  name: string;
  triggerType: string;
  scope: Record<string, unknown> | null;
  active: boolean;
  version: number;
  recipients: NotificationRuleRecipient[];
}

export interface SellerListResponse {
  total: number;
  rows: SellerListRow[];
}

export interface CreateLeadInput {
  journeyId: string;
  statusId?: string | undefined;
  existingLeadId?: string | undefined;
  name: string;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  fieldValues: Record<string, unknown>;
  assignments: ReadonlyArray<{ assignmentType: string; userId: string }>;
}

export interface EditLeadInput {
  leadId: string;
  processInstanceId: string;
  journeyId: string;
  name?: string | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  fieldValues?: Record<string, unknown> | undefined;
  statusId?: string | undefined;
  assignmentTypes?: readonly string[] | undefined;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
}

export interface CapabilitySet {
  permissions: Array<{ module: string; action: string; scope: DataScope }>;
  journeyIds: string[];
  fieldVisibility: Array<{ fieldId: string; accessLevel: FieldAccessLevel }>;
}
export interface Page<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}
export interface AdminJourney {
  id: string;
  key: string;
  name: string;
  active: boolean;
  statuses?: Status[];
  version?: number;
}
export interface AdminField {
  id: string;
  key: string;
  name: string;
  fieldType: string;
  validationRule: { options?: string[]; [key: string]: unknown } | null;
  section: string | null;
  editMode: string;
  source: string;
  active: boolean;
}
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  roleId: string;
  departmentId: string | null;
  managerId: string | null;
  active: boolean;
}
export interface AdminRole {
  id: string;
  key: string;
  name: string;
  active: boolean;
  version: number;
  permissions?: CapabilitySet['permissions'];
  journeyAccess?: Array<{ journeyId: string }>;
  fieldVisibility?: CapabilitySet['fieldVisibility'];
}
export interface Department {
  id: string;
  key: string;
  name: string;
  active: boolean;
  version: number;
}
export interface PermissionCatalog {
  modules: Array<{ module: string; label: string; actions: string[] }>;
  supportedScopes: DataScope[];
}

/** Flat, machine-readable API error-code body. */
export interface ApiErrorBody {
  error: string;
  details?: Record<string, unknown> | undefined;
}
