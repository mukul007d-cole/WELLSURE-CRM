import { resolveAuthorization, type PermissionRepository } from '@falcon/permission-engine';

import type { AuthenticatedContext } from '../auth/middleware.js';
import { isCsvError } from '@falcon/validation';
import { isImportError } from '../import/errors.js';
import type { ImportService } from '../import/service.js';
import type { ImportMapping } from '../import/types.js';

export const importAction = 'import' as const;
export const createAction = 'create' as const;

export type ImportRouteResult =
  | { status: 200 | 201; body: unknown }
  | { status: 400 | 403 | 409 | 413; body: { error: string; details?: Record<string, unknown> } };

/**
 * Authorization for a bulk import, decided once for the whole file.
 *
 * The mapping is per-file, so every row writes the same set of Fields, uses the
 * same Journey and names the same assignment types — one decision covers all of
 * them. That is not a shortcut: it is strictly no weaker than deciding per row
 * (a Field mapped but left blank in some row still requires edit rights), it
 * turns a would-be row-4000 403 into a mapping error that names the column, and
 * it makes the permission dimension of "the dry run predicts the commit" true by
 * construction rather than by test.
 *
 * Both actions are required. `leads:import` is an additional gate on top of the
 * ordinary creation check, never a replacement for it — the same shape
 * ADR-0015 established for `lead_routing:operate`.
 */
async function authorizeImport(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  journeyId: string;
  mappedFieldIds: readonly string[];
  assignmentTypes: readonly string[];
  columnNamesByFieldId: ReadonlyMap<string, string>;
  now?: Date | undefined;
}): Promise<{ ok: true } | { ok: false; result: ImportRouteResult }> {
  const organizationId = input.auth.user.organizationId;
  const timing = input.now === undefined ? {} : { now: input.now };
  const forbidden: ImportRouteResult = { status: 403, body: { error: 'forbidden' } };

  const gate = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId,
      userId: input.auth.user.id,
      module: 'leads',
      action: importAction,
      journeyId: input.journeyId,
      assignmentTypes: input.assignmentTypes,
      ...timing,
    },
  });
  if (!gate.allowed) return { ok: false, result: forbidden };

  const create = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId,
      userId: input.auth.user.id,
      module: 'leads',
      action: createAction,
      journeyId: input.journeyId,
      requestedEditFieldIds: [...input.mappedFieldIds],
      assignmentTypes: input.assignmentTypes,
      ...timing,
    },
  });
  if (create.allowed) return { ok: true };

  // Name the column when the reason is a Field the caller cannot write. "You do
  // not have permission to write to the column *Company name*" is actionable;
  // a bare 403 on a 47-column mapping is not.
  if (
    create.deniedReasons.length === 1 &&
    create.deniedReasons[0] === 'FIELD_EDIT_DENIED' &&
    create.fields.rejectedEditFieldIds.length > 0
  ) {
    return {
      ok: false,
      result: {
        status: 403,
        body: {
          error: 'field_edit_denied',
          details: {
            columns: create.fields.rejectedEditFieldIds.map(
              (fieldId) => input.columnNamesByFieldId.get(fieldId) ?? fieldId,
            ),
          },
        },
      },
    };
  }
  return { ok: false, result: forbidden };
}

/** Which Fields does this mapping write to, and under which column names? */
function mappedFields(mapping: ImportMapping): {
  fieldIds: string[];
  assignmentTypes: string[];
  columnNamesByFieldId: Map<string, string>;
} {
  const fieldIds: string[] = [];
  const assignmentTypes = new Set(
    mapping.assignments.map((assignment) => assignment.assignmentType.trim()),
  );
  const columnNamesByFieldId = new Map<string, string>();
  for (const [column, target] of Object.entries(mapping.columns ?? {})) {
    if (target.kind === 'field') {
      fieldIds.push(target.fieldId);
      columnNamesByFieldId.set(target.fieldId, column);
    }
    if (target.kind === 'assignment') assignmentTypes.add(target.assignmentType.trim());
  }
  return { fieldIds, assignmentTypes: [...assignmentTypes], columnNamesByFieldId };
}

/**
 * Step one. Gated on the same pair as the run, because the column names and
 * sample values of an uploaded file are already data worth withholding from
 * someone who may not import.
 */
export async function analyzeImportFile(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  importService: ImportService;
  fileName: string;
  content: string;
  now?: Date;
}): Promise<ImportRouteResult> {
  const gate = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module: 'leads',
      action: importAction,
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  });
  if (!gate.allowed) return { status: 403, body: { error: 'forbidden' } };
  try {
    return { status: 200, body: input.importService.analyze(input) };
  } catch (error) {
    return toResponse(error);
  }
}

/** Steps two and three: preview, then commit. One handler, because one path. */
export async function runImport(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  importService: ImportService;
  mode: 'preview' | 'commit';
  fileName: string;
  content: string;
  mapping: ImportMapping;
  stopOnError?: boolean;
  expectedContentHash?: string | undefined;
  now?: Date;
}): Promise<ImportRouteResult> {
  const { fieldIds, assignmentTypes, columnNamesByFieldId } = mappedFields(input.mapping);
  const authorized = await authorizeImport({
    auth: input.auth,
    permissionRepository: input.permissionRepository,
    journeyId: input.mapping.journeyId,
    mappedFieldIds: fieldIds,
    assignmentTypes,
    columnNamesByFieldId,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  if (!authorized.ok) return authorized.result;

  // The predicate that decides which duplicate matches may be named. Taken from
  // `leads:view` for the same reason the export takes it from there.
  const view = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module: 'leads',
      action: 'view',
      journeyId: input.mapping.journeyId,
      assignmentTypes,
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  });

  try {
    return {
      status: 200,
      body: await input.importService.run({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        mode: input.mode,
        fileName: input.fileName,
        content: input.content,
        mapping: input.mapping,
        ...(input.stopOnError === undefined ? {} : { stopOnError: input.stopOnError }),
        // An importer with no `leads:view` scope at all can still import; they
        // simply cannot be told the identity of anything they matched.
        recordPredicate: view.recordPredicate ?? {
          organizationId: input.auth.user.organizationId,
          scope: 'SELF',
          allowedUserIds: [],
          assignmentTypes: [],
          journeyIds: [],
          includeDirectGrantsForUserId: input.auth.user.id,
          directGrantAction: 'view',
        },
        ...(input.expectedContentHash === undefined
          ? {}
          : { expectedContentHash: input.expectedContentHash }),
      }),
    };
  } catch (error) {
    return toResponse(error);
  }
}

function toResponse(error: unknown): ImportRouteResult {
  if (isCsvError(error)) {
    return { status: 400, body: { error: error.code, details: error.details } };
  }
  if (isImportError(error)) {
    const status = error.code === 'conflict' ? 409 : error.code === 'payload_too_large' ? 413 : 400;
    return { status, body: { error: error.code, details: error.details } };
  }
  throw error;
}
