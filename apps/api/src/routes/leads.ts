import { resolveAuthorization, type PermissionRepository } from '@falcon/permission-engine';

import type { AuthenticatedContext } from '../auth/middleware.js';
import { isLeadError, type LeadError } from '../leads/errors.js';
import {
  LeadService,
  type LeadAssignmentRecord,
  type LeadCoreRecord,
  type LeadProcessRecord,
  type LeadRepository,
} from '../leads/service.js';

export const leadsModule = 'leads' as const;
export const viewAction = 'view' as const;
export const createAction = 'create' as const;
export const editAction = 'edit' as const;

export interface LeadDetailRecord {
  id: string;
  organizationId: string;
  name: string;
  phone: string | null;
  email: string | null;
  fieldValues: Record<string, unknown>;
  processInstances: Array<{ journeyId: string; active: boolean }>;
}

export interface Seller360Record extends LeadCoreRecord {
  processInstances: Array<
    LeadProcessRecord & {
      assignments: LeadAssignmentRecord[];
      journey: { id: string; key: string; name: string };
      currentStatus: { id: string; key: string; name: string };
    }
  >;
}

export interface SellerListProcessSummary {
  processInstanceId: string;
  journeyId: string;
  journeyName: string;
  statusId: string;
  statusName: string;
  statusOutcomeType: string;
  statusBehaviorType: string;
  ownerName: string | null;
}

export interface SellerListRecord extends LeadCoreRecord {
  processInstances: SellerListProcessSummary[];
  shared?: boolean;
}

export interface LeadReadRepository {
  findLeadById(organizationId: string, leadId: string): Promise<LeadDetailRecord | null>;
}

export interface SellerReadRepository {
  findSeller360(organizationId: string, leadId: string): Promise<Seller360Record | null>;
  listSellers(
    input: SellerListInput & {
      organizationId: string;
      recordPredicate: NonNullable<
        Awaited<ReturnType<typeof resolveAuthorization>>['recordPredicate']
      >;
    },
  ): Promise<{
    rows: SellerListRecord[];
    total: number;
  }>;
}

export interface SellerListInput {
  search?: string;
  journeyId?: string;
  statusId?: string;
  ownerUserId?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'name';
  sortDirection?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  requestedFieldIds: readonly string[];
  assignmentTypes: readonly string[];
  accessMode?: 'mine' | 'shared_with_me' | 'all';
}

export type LeadRouteResult =
  | { status: 200 | 201; body: unknown }
  | { status: 400 | 403 | 404 | 409; body: { error: string; details?: Record<string, unknown> } };

export async function createLead(input: {
  auth: AuthenticatedContext;
  leadRepository: LeadRepository;
  permissionRepository: PermissionRepository;
  journeyId: string;
  statusId?: string;
  existingLeadId?: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  fieldValues: Record<string, unknown>;
  assignments: readonly { assignmentType: string; userId: string }[];
  now?: Date;
}): Promise<LeadRouteResult> {
  const assignmentTypes = input.assignments.map((assignment) => assignment.assignmentType);
  const decision = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module: leadsModule,
      action: createAction,
      journeyId: input.journeyId,
      requestedEditFieldIds: Object.keys(input.fieldValues),
      assignmentTypes,
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  });
  if (!decision.allowed) return { status: 403, body: { error: 'forbidden' } };
  try {
    return {
      status: 201,
      body: await new LeadService(input.leadRepository).createLead({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        journeyId: input.journeyId,
        ...(input.statusId === undefined ? {} : { statusId: input.statusId }),
        ...(input.existingLeadId === undefined ? {} : { existingLeadId: input.existingLeadId }),
        name: input.name,
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.email === undefined ? {} : { email: input.email }),
        fieldValues: input.fieldValues,
        assignments: input.assignments,
      }),
    };
  } catch (error) {
    if (!isLeadError(error)) throw error;
    return toResponse(error);
  }
}

export async function editLead(input: {
  auth: AuthenticatedContext;
  leadRepository: LeadRepository;
  permissionRepository: PermissionRepository;
  processInstanceId: string;
  journeyId: string;
  leadId: string;
  assignmentTypes: readonly string[];
  name?: string;
  phone?: string | null;
  email?: string | null;
  fieldValues?: Record<string, unknown>;
  statusId?: string;
  now?: Date;
}): Promise<LeadRouteResult> {
  const decision = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module: leadsModule,
      action: editAction,
      journeyId: input.journeyId,
      leadId: input.leadId,
      requestedEditFieldIds: Object.keys(input.fieldValues ?? {}),
      assignmentTypes: input.assignmentTypes,
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  });
  if (!decision.allowed) return { status: 403, body: { error: 'forbidden' } };
  try {
    return {
      status: 200,
      body: await new LeadService(input.leadRepository).editLead({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        processInstanceId: input.processInstanceId,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.fieldValues === undefined ? {} : { fieldValues: input.fieldValues }),
        ...(input.statusId === undefined ? {} : { statusId: input.statusId }),
      }),
    };
  } catch (error) {
    if (!isLeadError(error)) throw error;
    return toResponse(error);
  }
}

export async function getLeadById(input: {
  auth: AuthenticatedContext;
  leadId: string;
  leadRepository: LeadReadRepository;
  permissionRepository: PermissionRepository;
  requestedFieldIds: readonly string[];
  assignmentTypes: readonly string[];
  now?: Date | undefined;
}): Promise<{ status: 200; body: unknown } | { status: 403 | 404; body: { error: string } }> {
  const lead = await input.leadRepository.findLeadById(
    input.auth.user.organizationId,
    input.leadId,
  );
  const process = lead?.processInstances.find((row) => row.active);
  if (lead === null || lead === undefined || process === undefined) {
    return { status: 404, body: { error: 'not_found' } };
  }

  const decision = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module: leadsModule,
      action: viewAction,
      journeyId: process.journeyId,
      leadId: lead.id,
      requestedFieldIds: input.requestedFieldIds,
      assignmentTypes: input.assignmentTypes,
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  });

  const blockingReasons = decision.deniedReasons.filter((reason) => reason !== 'FIELD_VIEW_DENIED');
  if (blockingReasons.length > 0) {
    return { status: 403, body: { error: 'forbidden' } };
  }

  return {
    status: 200,
    body: serializeLead(lead, decision.fields.visibleFieldIds),
  };
}

export async function listSellers(input: {
  auth: AuthenticatedContext;
  sellerRepository: SellerReadRepository;
  permissionRepository: PermissionRepository;
  list: SellerListInput;
  now?: Date;
}): Promise<LeadRouteResult> {
  const decision = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module: leadsModule,
      action: viewAction,
      ...(input.list.journeyId === undefined ? {} : { journeyId: input.list.journeyId }),
      requestedFieldIds: input.list.requestedFieldIds,
      assignmentTypes: input.list.assignmentTypes,
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  });
  const blockingReasons = decision.deniedReasons.filter((reason) => reason !== 'FIELD_VIEW_DENIED');
  if (blockingReasons.length > 0) return { status: 403, body: { error: 'forbidden' } };
  const result = await input.sellerRepository.listSellers({
    ...input.list,
    organizationId: input.auth.user.organizationId,
    recordPredicate: decision.recordPredicate!,
  });
  return {
    status: 200,
    body: {
      total: result.total,
      rows: result.rows.map((row) => ({
        ...serializeLead(row, decision.fields.visibleFieldIds),
        processInstances: row.processInstances,
      })),
    },
  };
}

export async function getSeller360(input: {
  auth: AuthenticatedContext;
  leadId: string;
  sellerRepository: SellerReadRepository;
  permissionRepository: PermissionRepository;
  requestedFieldIds: readonly string[];
  assignmentTypes: readonly string[];
  now?: Date;
}): Promise<LeadRouteResult> {
  const lead = await input.sellerRepository.findSeller360(
    input.auth.user.organizationId,
    input.leadId,
  );
  if (lead === null) return { status: 404, body: { error: 'not_found' } };
  const visibleProcesses: Seller360Record['processInstances'] = [];
  const visibleFieldIds = new Set<string>();
  for (const process of lead.processInstances.filter((row) => row.active)) {
    const decision = await resolveAuthorization({
      repository: input.permissionRepository,
      request: {
        organizationId: input.auth.user.organizationId,
        userId: input.auth.user.id,
        module: leadsModule,
        action: viewAction,
        journeyId: process.journeyId,
        leadId: lead.id,
        requestedFieldIds: input.requestedFieldIds,
        assignmentTypes: input.assignmentTypes,
        ...(input.now === undefined ? {} : { now: input.now }),
      },
    });
    const blockingReasons = decision.deniedReasons.filter(
      (reason) => reason !== 'FIELD_VIEW_DENIED',
    );
    if (blockingReasons.length === 0) {
      visibleProcesses.push(process);
      for (const fieldId of decision.fields.visibleFieldIds) {
        visibleFieldIds.add(fieldId);
      }
    }
  }
  if (visibleProcesses.length === 0) return { status: 403, body: { error: 'forbidden' } };
  return {
    status: 200,
    body: { ...serializeLead(lead, [...visibleFieldIds]), processInstances: visibleProcesses },
  };
}

function serializeLead(
  lead: Pick<LeadCoreRecord, 'id' | 'name' | 'phone' | 'email' | 'fieldValues'>,
  visibleFieldIds: readonly string[],
): {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  fieldValues: Record<string, unknown>;
} {
  const visible = new Set(visibleFieldIds);
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    fieldValues: Object.fromEntries(
      Object.entries(lead.fieldValues).filter(([fieldId]) => visible.has(fieldId)),
    ),
  };
}

function toResponse(error: LeadError): LeadRouteResult {
  const status =
    error.code === 'not_found'
      ? 404
      : error.code === 'dependency_conflict'
        ? 409
        : error.code === 'forbidden'
          ? 403
          : 400;
  return {
    status,
    body: {
      error: error.code,
      ...(Object.keys(error.details).length === 0 ? {} : { details: error.details }),
    },
  };
}
