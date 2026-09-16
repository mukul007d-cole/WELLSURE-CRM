import { resolveAuthorization, type PermissionRepository } from '@falcon/permission-engine';

import type { AuthenticatedContext } from '../auth/middleware.js';
import { isToolError } from '../tools/errors.js';
import type { ResourceService } from '../tools/service.js';
import type { ResourceFileInput, ResourceMetadataInput } from '../tools/types.js';
import {
  optionalText,
  parseInstructions,
  requireAllowedFile,
  requireResourceName,
  requireResourceType,
  requireResourceUrl,
  requireRoleIds,
} from '../tools/validation.js';

/**
 * Per-resource visibility reads, layered on `PermissionRepository` the same
 * way `CapabilityReader` layers on it for `/auth/capabilities` — a small,
 * feature-owned extension rather than a change to the core engine, since a
 * Resource has no relationship to the lead/journey/status decision
 * `resolveAuthorization` resolves. See `PrismaPermissionRepository`.
 */
export interface ResourceVisibilityReader {
  hasResourceVisibility(input: {
    roleId: string;
    organizationId: string;
    resourceId: string;
  }): Promise<boolean>;
}

export interface ToolRouteDeps {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository & ResourceVisibilityReader;
  resourceService: ResourceService;
}

export type ToolRouteResult =
  | { status: 200 | 201; body: unknown }
  | {
      status: 400 | 403 | 404 | 409 | 503;
      body: { error: string; details?: Record<string, unknown> };
    };

const adminActions = ['create', 'edit', 'delete'] as const;

async function can(deps: ToolRouteDeps, module: string, action: string): Promise<boolean> {
  const decision = await resolveAuthorization({
    repository: deps.permissionRepository,
    request: {
      organizationId: deps.auth.user.organizationId,
      userId: deps.auth.user.id,
      module,
      action,
    },
  });
  return decision.allowed;
}

/**
 * Whether the caller currently holds any Tools admin action — the gate for
 * honoring a client-requested `admin=true` list/detail mode. Re-derived on
 * every call from the caller's actual grants; a `tools:view`-only caller
 * requesting admin mode is silently served the ordinary filtered view rather
 * than erroring or being trusted, per Phase 19's "never trust what the
 * client asserts about its own context" lesson applied to this new pattern.
 */
async function canAdminister(deps: ToolRouteDeps): Promise<boolean> {
  const results = await Promise.all(adminActions.map((action) => can(deps, 'tools', action)));
  return results.some(Boolean);
}

function parseMetadata(body: Record<string, unknown>): ResourceMetadataInput {
  const type = requireResourceType(body.type);
  return {
    name: requireResourceName(body.name),
    description: optionalText(body.description),
    category: optionalText(body.category),
    type,
    url: type === 'link' ? requireResourceUrl(body.url) : null,
    instructions: parseInstructions(body.instructions),
  };
}

function validateFile(file: ResourceFileInput): void {
  requireAllowedFile({
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.body.byteLength,
    body: file.body,
  });
}

function fromToolError(error: unknown): ToolRouteResult {
  if (!isToolError(error)) throw error;
  const status =
    error.code === 'not_found'
      ? 404
      : error.code === 'conflict'
        ? 409
        : error.code === 'storage_not_configured'
          ? 503
          : 400;
  return {
    status,
    body: {
      error: error.code,
      ...(Object.keys(error.details).length ? { details: error.details } : {}),
    },
  };
}

export async function listResourcesRoute(
  input: ToolRouteDeps & {
    admin: boolean;
    active: boolean | undefined;
    page: number;
    pageSize: number;
  },
): Promise<ToolRouteResult> {
  if (!(await can(input, 'tools', 'view'))) return { status: 403, body: { error: 'forbidden' } };
  const adminMode = input.admin && (await canAdminister(input));
  const result = await input.resourceService.list({
    organizationId: input.auth.user.organizationId,
    // Browse mode always forces active-only, server-side — the caller's
    // `active` param is honored only once admin mode is itself re-derived.
    roleId: adminMode ? null : input.auth.user.roleId,
    active: adminMode ? input.active : true,
    page: input.page,
    pageSize: input.pageSize,
  });
  return { status: 200, body: result };
}

export async function getResourceRoute(
  input: ToolRouteDeps & { resourceId: string; admin: boolean },
): Promise<ToolRouteResult> {
  if (!(await can(input, 'tools', 'view'))) return { status: 403, body: { error: 'forbidden' } };
  const resource = await input.resourceService.get(
    input.auth.user.organizationId,
    input.resourceId,
  );
  if (resource === null) return { status: 404, body: { error: 'not_found' } };
  if (input.admin && (await canAdminister(input))) return { status: 200, body: resource };
  if (!resource.active) return { status: 403, body: { error: 'forbidden' } };
  const visible = await input.permissionRepository.hasResourceVisibility({
    roleId: input.auth.user.roleId,
    organizationId: input.auth.user.organizationId,
    resourceId: input.resourceId,
  });
  if (!visible) return { status: 403, body: { error: 'forbidden' } };
  return { status: 200, body: resource };
}

/**
 * Authorizes a download and returns the record to stream — never the bytes
 * themselves; the HTTP layer streams those directly, mirroring
 * `http/routes/attachments.ts` exactly (see docs/planning/phase-22-…md §3
 * for why this project serves files by proxying an authenticated request
 * rather than issuing a signed URL).
 *
 * Deliberately never admin-bypassed: holding `tools:edit` lets an admin
 * manage a Resource's definition, not download bytes their own Role isn't
 * granted — the same independence `field_visibility` keeps from `fields:edit`.
 */
export async function authorizeDownloadRoute(
  input: ToolRouteDeps & { resourceId: string },
): Promise<ToolRouteResult> {
  if (!(await can(input, 'tools', 'view'))) return { status: 403, body: { error: 'forbidden' } };
  const resource = await input.resourceService.get(
    input.auth.user.organizationId,
    input.resourceId,
  );
  if (resource === null || !resource.active) return { status: 404, body: { error: 'not_found' } };
  const visible = await input.permissionRepository.hasResourceVisibility({
    roleId: input.auth.user.roleId,
    organizationId: input.auth.user.organizationId,
    resourceId: input.resourceId,
  });
  if (!visible) return { status: 403, body: { error: 'forbidden' } };
  if (resource.type !== 'file')
    return { status: 400, body: { error: 'validation_error', details: { type: resource.type } } };
  return { status: 200, body: resource };
}

export async function createResourceRoute(
  input: ToolRouteDeps & { body: Record<string, unknown>; file: ResourceFileInput | null },
): Promise<ToolRouteResult> {
  if (!(await can(input, 'tools', 'create'))) return { status: 403, body: { error: 'forbidden' } };
  try {
    const metadata = parseMetadata(input.body);
    if (input.file) validateFile(input.file);
    const row = await input.resourceService.create({
      organizationId: input.auth.user.organizationId,
      actorUserId: input.auth.user.id,
      metadata,
      file: input.file,
      sortOrder: 0,
    });
    return { status: 201, body: row };
  } catch (error) {
    return fromToolError(error);
  }
}

export async function updateResourceRoute(
  input: ToolRouteDeps & {
    resourceId: string;
    body: Record<string, unknown>;
    file: ResourceFileInput | null;
  },
): Promise<ToolRouteResult> {
  if (!(await can(input, 'tools', 'edit'))) return { status: 403, body: { error: 'forbidden' } };
  try {
    const metadata = parseMetadata(input.body);
    if (input.file) validateFile(input.file);
    const row = await input.resourceService.update({
      organizationId: input.auth.user.organizationId,
      actorUserId: input.auth.user.id,
      resourceId: input.resourceId,
      metadata,
      file: input.file,
    });
    return { status: 200, body: row };
  } catch (error) {
    return fromToolError(error);
  }
}

export async function deactivateResourceRoute(
  input: ToolRouteDeps & { resourceId: string },
): Promise<ToolRouteResult> {
  if (!(await can(input, 'tools', 'delete'))) return { status: 403, body: { error: 'forbidden' } };
  try {
    const row = await input.resourceService.deactivate(
      input.auth.user.organizationId,
      input.auth.user.id,
      input.resourceId,
    );
    return { status: 200, body: row };
  } catch (error) {
    return fromToolError(error);
  }
}

export async function listResourceVisibilityRoute(
  input: ToolRouteDeps & { resourceId: string },
): Promise<ToolRouteResult> {
  if (!(await can(input, 'roles_permissions', 'view')))
    return { status: 403, body: { error: 'forbidden' } };
  const roleIds = await input.resourceService.listVisibility(
    input.auth.user.organizationId,
    input.resourceId,
  );
  if (roleIds === null) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: { roleIds } };
}

export async function replaceResourceVisibilityRoute(
  input: ToolRouteDeps & { resourceId: string; body: Record<string, unknown> },
): Promise<ToolRouteResult> {
  if (!(await can(input, 'roles_permissions', 'edit')))
    return { status: 403, body: { error: 'forbidden' } };
  try {
    const roleIds = requireRoleIds(input.body.roleIds);
    const result = await input.resourceService.replaceVisibility({
      organizationId: input.auth.user.organizationId,
      actorUserId: input.auth.user.id,
      resourceId: input.resourceId,
      roleIds,
    });
    return { status: 200, body: { roleIds: result } };
  } catch (error) {
    return fromToolError(error);
  }
}
