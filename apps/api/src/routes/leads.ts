import { resolveAuthorization, type PermissionRepository } from '@falcon/permission-engine';

import type { AuthenticatedContext } from '../auth/middleware.js';
import {
  pickVisibleFieldValues,
  serializeActivityEntry,
  type LeadActivityRow,
} from '../leads/activity-read.js';
import { isLeadError, type LeadError } from '../leads/errors.js';
import { filterFieldIds } from '../leads/filter-model.js';
import { parseFilter, resolveFilter, type ResolvedCondition } from '../leads/filter-validation.js';
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
      currentStatus: {
        id: string;
        key: string;
        name: string;
        outcomeType: string;
        behaviorType: string;
      };
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

export interface LeadActivityReadRepository {
  findLeadActivity(
    organizationId: string,
    leadId: string,
    input: {
      visibleProcessInstanceIds: readonly string[];
      page: number;
      pageSize: number;
    },
  ): Promise<{ total: number; rows: LeadActivityRow[] }>;
}

export interface SellerReadRepository {
  findSeller360(organizationId: string, leadId: string): Promise<Seller360Record | null>;
  /**
   * `fieldId -> field_type` for active Fields. The operator catalog is derived
   * from this rather than from the request, so a Field's operators follow its
   * configuration.
   */
  listFilterableFieldTypes(organizationId: string): Promise<ReadonlyMap<string, string>>;
  /** The full matching id set, bounded — used by manual campaign sends. */
  listMatchingLeadIds(input: {
    organizationId: string;
    recordPredicate: NonNullable<
      Awaited<ReturnType<typeof resolveAuthorization>>['recordPredicate']
    >;
    conditions?: readonly ResolvedCondition[];
    limit: number;
  }): Promise<string[]>;
  listSellers(
    input: SellerListInput & {
      organizationId: string;
      recordPredicate: NonNullable<
        Awaited<ReturnType<typeof resolveAuthorization>>['recordPredicate']
      >;
      conditions?: readonly ResolvedCondition[];
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
  /** Raw filter payload from the client; parsed and re-validated server-side. */
  filter?: unknown;
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

/**
 * Move a lead's process instance into a different journey.
 *
 * Authorized against **both** journeys: `edit` on the one it is leaving and
 * `create` on the one it is entering. Checking only the source would let
 * someone push a record into a journey they have no rights to; checking only
 * the target would let them pull one out of a journey they cannot touch.
 */
export async function moveLeadJourney(input: {
  auth: AuthenticatedContext;
  leadRepository: LeadRepository;
  permissionRepository: PermissionRepository;
  leadId: string;
  processInstanceId: string;
  journeyId: string;
  targetJourneyId: string;
  assignmentTypes: readonly string[];
  statusId?: string;
  now?: Date;
}): Promise<LeadRouteResult> {
  for (const [journeyId, action] of [
    [input.journeyId, editAction],
    [input.targetJourneyId, createAction],
  ] as const) {
    const decision = await resolveAuthorization({
      repository: input.permissionRepository,
      request: {
        organizationId: input.auth.user.organizationId,
        userId: input.auth.user.id,
        module: leadsModule,
        action,
        journeyId,
        leadId: input.leadId,
        assignmentTypes: input.assignmentTypes,
        ...(input.now === undefined ? {} : { now: input.now }),
      },
    });
    if (!decision.allowed) return { status: 403, body: { error: 'forbidden' } };
  }
  try {
    const result = await new LeadService(input.leadRepository).moveJourney({
      organizationId: input.auth.user.organizationId,
      actorUserId: input.auth.user.id,
      processInstanceId: input.processInstanceId,
      targetJourneyId: input.targetJourneyId,
      ...(input.statusId === undefined ? {} : { statusId: input.statusId }),
    });
    return { status: 200, body: result };
  } catch (error) {
    if (isLeadError(error)) return toResponse(error);
    throw error;
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
  let filter;
  try {
    filter = parseFilter(input.list.filter);
  } catch (error) {
    if (!isLeadError(error)) throw error;
    return { status: 400, body: { error: error.code, details: error.details } };
  }
  const filteredFieldIds = filterFieldIds(filter);
  const decision = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module: leadsModule,
      action: viewAction,
      ...(input.list.journeyId === undefined ? {} : { journeyId: input.list.journeyId }),
      // The filter's Fields are requested too, so the engine decides on them
      // rather than the client deciding by omission.
      requestedFieldIds: [...new Set([...input.list.requestedFieldIds, ...filteredFieldIds])],
      assignmentTypes: input.list.assignmentTypes,
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  });
  const blockingReasons = decision.deniedReasons.filter((reason) => reason !== 'FIELD_VIEW_DENIED');
  if (blockingReasons.length > 0) return { status: 403, body: { error: 'forbidden' } };
  /*
   * FIELD_VIEW_DENIED is deliberately non-blocking above: a *requested* column
   * the caller can't see is stripped from the response. A *filter* on such a
   * Field is a different question and must not inherit that leniency —
   * dropping the condition would silently return a wider set than asked for,
   * and treating it as false would silently return none. Both are worse than
   * an error. The body names no field id, so this cannot be used to probe which
   * Fields exist.
   */
  const visible = new Set(decision.fields.visibleFieldIds);
  if (filteredFieldIds.some((fieldId) => !visible.has(fieldId)))
    return { status: 403, body: { error: 'forbidden' } };

  let conditions;
  try {
    conditions = resolveFilter({
      filter,
      fieldTypes: await input.sellerRepository.listFilterableFieldTypes(
        input.auth.user.organizationId,
      ),
    });
  } catch (error) {
    if (!isLeadError(error)) throw error;
    return { status: 400, body: { error: error.code, details: error.details } };
  }
  const result = await input.sellerRepository.listSellers({
    ...input.list,
    organizationId: input.auth.user.organizationId,
    recordPredicate: decision.recordPredicate!,
    conditions,
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
  const access = await resolveLeadAccess(input);
  if (access.status !== 200) return access.result;
  return {
    status: 200,
    body: {
      ...serializeLead(access.lead, [...access.visibleFieldIds]),
      processInstances: access.visibleProcesses,
    },
  };
}

/**
 * The lead's append-only history.
 *
 * Authorization is the same loop `getSeller360` runs — resolve per active
 * process instance, keep the ones that pass, union their visible field ids —
 * so the timeline inherits journey access, record scope and field visibility
 * without restating any of those rules.
 */
export async function getLeadActivity(input: {
  auth: AuthenticatedContext;
  leadId: string;
  sellerRepository: SellerReadRepository & LeadActivityReadRepository;
  permissionRepository: PermissionRepository;
  requestedFieldIds: readonly string[];
  assignmentTypes: readonly string[];
  page?: number;
  pageSize?: number;
  now?: Date;
}): Promise<LeadRouteResult> {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  if (!Number.isInteger(page) || page < 1) {
    return { status: 400, body: { error: 'validation_error', details: { field: 'page' } } };
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return { status: 400, body: { error: 'validation_error', details: { field: 'pageSize' } } };
  }

  const access = await resolveLeadAccess(input);
  if (access.status !== 200) return access.result;

  const { total, rows } = await input.sellerRepository.findLeadActivity(
    input.auth.user.organizationId,
    input.leadId,
    {
      // Filtering in the query rather than after the fetch: post-filtering a
      // page would return short pages and an inflated total.
      visibleProcessInstanceIds: access.visibleProcesses.map((row) => row.id),
      page,
      pageSize,
    },
  );
  return {
    status: 200,
    body: {
      page,
      pageSize,
      total,
      items: rows.map((row) => serializeActivityEntry(row, access.visibleFieldIds)),
    },
  };
}

/**
 * Per-process authorization for one lead, shared by Seller 360 and the
 * timeline. A lead can sit in several journeys and the viewer may be entitled
 * to only some of them.
 */
async function resolveLeadAccess(input: {
  auth: AuthenticatedContext;
  leadId: string;
  sellerRepository: SellerReadRepository;
  permissionRepository: PermissionRepository;
  requestedFieldIds: readonly string[];
  assignmentTypes: readonly string[];
  now?: Date;
}): Promise<
  | {
      status: 200;
      lead: Seller360Record;
      visibleProcesses: Seller360Record['processInstances'];
      visibleFieldIds: Set<string>;
    }
  | { status: 403 | 404; result: LeadRouteResult }
> {
  const lead = await input.sellerRepository.findSeller360(
    input.auth.user.organizationId,
    input.leadId,
  );
  if (lead === null) return { status: 404, result: { status: 404, body: { error: 'not_found' } } };

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
      for (const fieldId of decision.fields.visibleFieldIds) visibleFieldIds.add(fieldId);
    }
  }
  if (visibleProcesses.length === 0) {
    return { status: 403, result: { status: 403, body: { error: 'forbidden' } } };
  }
  return { status: 200, lead, visibleProcesses, visibleFieldIds };
}

function serializeLead(
  lead: Pick<
    LeadCoreRecord,
    'id' | 'name' | 'phone' | 'email' | 'fieldValues' | 'createdAt' | 'updatedAt'
  >,
  visibleFieldIds: readonly string[],
): {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  createdAt?: string;
  updatedAt?: string;
  fieldValues: Record<string, unknown>;
} {
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    // Columns that have always existed and the serializer simply dropped, so
    // the record page had no "added on" to show. Optional because the list
    // query doesn't always select them.
    ...(lead.createdAt ? { createdAt: lead.createdAt.toISOString() } : {}),
    ...(lead.updatedAt ? { updatedAt: lead.updatedAt.toISOString() } : {}),
    fieldValues: pickVisibleFieldValues(lead.fieldValues, new Set(visibleFieldIds)),
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
