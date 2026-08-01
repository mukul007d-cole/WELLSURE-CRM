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

export interface Status {
  id: string;
  journeyId: string;
  key: string;
  name: string;
  outcomeType: OutcomeType;
  behaviorType: BehaviorType;
  isActive: boolean;
  sortOrder: number;
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
