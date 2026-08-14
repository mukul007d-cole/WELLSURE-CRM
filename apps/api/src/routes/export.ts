import { resolveAuthorization, type PermissionRepository } from '@falcon/permission-engine';

import type { AuthenticatedContext } from '../auth/middleware.js';
import { buildSellerExport, type ExportFieldColumn } from '../export/service.js';
import { isLeadError } from '../leads/errors.js';
import { filterFieldIds } from '../leads/filter-model.js';
import { parseFilter, resolveFilter } from '../leads/filter-validation.js';
import type { SellerListInput, SellerReadRepository } from './leads.js';

export const exportAction = 'export' as const;

export interface ExportFieldRepository {
  /** Every active Field in the organization: `id` and the admin's own name. */
  listActiveFields(organizationId: string): Promise<ExportFieldColumn[]>;
}

export interface ExportAuditWriter {
  writeExportAudit(input: {
    organizationId: string;
    actorUserId: string;
    runId: string;
    detail: Record<string, unknown>;
  }): Promise<void>;
}

export type ExportRouteResult =
  | { status: 200; headers: Record<string, string>; body: string }
  | { status: 400 | 403; body: { error: string; details?: Record<string, unknown> } };

/**
 * `GET /leads/export`.
 *
 * Two authorization calls, deliberately.
 *
 * **`leads:export` is the gate** — it decides whether this caller may export at
 * all, and nothing else.
 *
 * **`leads:view` supplies the record predicate and the visible Field set** —
 * because scope is stored per (role, module, action) (`decision.ts`), so
 * authorizing the *data* against `leads:export` would let a role configured
 * `export` at ORGANIZATION scope while `view` is SELF export records it cannot
 * list. Taking the predicate from `view` makes "never a row or a field the same
 * user could not see in the list" structurally true rather than dependent on an
 * admin keeping two scopes consistent.
 *
 * The accepted cost, stated in ADR-0016: a deliberately *narrower* scope
 * configured on `leads:export` is not honoured. `export` is a capability, not a
 * scope.
 */
export async function exportSellers(input: {
  auth: AuthenticatedContext;
  sellerRepository: SellerReadRepository;
  permissionRepository: PermissionRepository;
  fieldRepository: ExportFieldRepository;
  audit: ExportAuditWriter;
  list: SellerListInput;
  runId: string;
  now?: Date;
}): Promise<ExportRouteResult> {
  let filter;
  try {
    filter = parseFilter(input.list.filter);
  } catch (error) {
    if (!isLeadError(error)) throw error;
    return { status: 400, body: { error: error.code, details: error.details } };
  }

  const organizationId = input.auth.user.organizationId;
  const journeyContext =
    input.list.journeyId === undefined ? {} : { journeyId: input.list.journeyId };
  const timing = input.now === undefined ? {} : { now: input.now };

  const gate = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId,
      userId: input.auth.user.id,
      module: 'leads',
      action: exportAction,
      ...journeyContext,
      assignmentTypes: input.list.assignmentTypes,
      ...timing,
    },
  });
  if (!gate.allowed) return { status: 403, body: { error: 'forbidden' } };

  // Ask for every Field, so the engine — not the client — decides the columns.
  const allFields = await input.fieldRepository.listActiveFields(organizationId);
  const filteredFieldIds = filterFieldIds(filter);
  const decision = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId,
      userId: input.auth.user.id,
      module: 'leads',
      action: 'view',
      ...journeyContext,
      requestedFieldIds: [...new Set([...allFields.map((field) => field.id), ...filteredFieldIds])],
      assignmentTypes: input.list.assignmentTypes,
      ...timing,
    },
  });
  // Same leniency as the list: a Field the caller cannot see is stripped, not a
  // 403. Here that means it is absent from the header — so the CSV does not even
  // disclose that the Field exists.
  const blocking = decision.deniedReasons.filter((reason) => reason !== 'FIELD_VIEW_DENIED');
  if (blocking.length > 0 || decision.recordPredicate === null) {
    return { status: 403, body: { error: 'forbidden' } };
  }
  const visible = new Set(decision.fields.visibleFieldIds);
  // A *filter* on an invisible Field is refused, exactly as the list refuses it:
  // dropping the condition would widen the result and treating it as false would
  // empty it, and both are worse than an error.
  if (filteredFieldIds.some((fieldId) => !visible.has(fieldId))) {
    return { status: 403, body: { error: 'forbidden' } };
  }

  let conditions;
  try {
    conditions = resolveFilter({
      filter,
      fieldTypes: await input.sellerRepository.listFilterableFieldTypes(organizationId),
    });
  } catch (error) {
    if (!isLeadError(error)) throw error;
    return { status: 400, body: { error: error.code, details: error.details } };
  }

  const result = await buildSellerExport({
    organizationId,
    sellerRepository: input.sellerRepository,
    recordPredicate: decision.recordPredicate,
    conditions,
    list: input.list,
    fields: allFields.filter((field) => visible.has(field.id)),
  });

  await input.audit.writeExportAudit({
    organizationId,
    actorUserId: input.auth.user.id,
    runId: input.runId,
    detail: {
      rowCount: result.rowCount,
      truncated: result.truncated,
      fieldIds: result.fieldIds,
      filters: {
        ...(input.list.search === undefined ? {} : { search: input.list.search }),
        ...journeyContext,
        ...(input.list.statusId === undefined ? {} : { statusId: input.list.statusId }),
        ...(input.list.ownerUserId === undefined ? {} : { ownerUserId: input.list.ownerUserId }),
        ...(input.list.accessMode === undefined ? {} : { accessMode: input.list.accessMode }),
        ...(filter === undefined ? {} : { filter: JSON.stringify(filter) }),
      },
    },
  });

  return {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="sellers-${timestamp()}.csv"`,
      // Says so rather than returning a short file silently.
      ...(result.truncated ? { 'x-export-truncated': 'true' } : {}),
      'x-export-row-count': String(result.rowCount),
    },
    body: result.csv,
  };
}

function timestamp(): string {
  return new Date().toISOString().slice(0, 19).replaceAll(':', '-');
}
