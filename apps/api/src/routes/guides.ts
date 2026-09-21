import { resolveAuthorization, type PermissionRepository } from '@falcon/permission-engine';

import type { AuthenticatedContext } from '../auth/middleware.js';
import { isGuideId, readGuide, type GuideId } from '../guides/service.js';

export type GuideRouteResult =
  | { status: 200; body: { content: string; fileName: string; title: string } }
  | { status: 403 | 404; body: { error: string } };

/**
 * The User Guide is for anyone signed in — every account holds `leads:view`
 * at some scope, so that alone is the floor gate. The Admin Guide documents
 * the configuration screens (Journeys, Fields, Roles, Users…), so it is
 * gated on `roles_permissions:view` — the one capability that, in this
 * catalog, only an administrator-shaped Role actually holds (see
 * `docs/permissions/access-model.md`); a role name is configuration, never
 * something application code branches on (`AGENTS.md`).
 */
export async function getGuide(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  guide: string;
}): Promise<GuideRouteResult> {
  if (!isGuideId(input.guide)) {
    return { status: 404, body: { error: 'not_found' } };
  }
  const allowed = await isGuideAllowed(input.auth, input.permissionRepository, input.guide);
  if (!allowed) {
    return { status: 403, body: { error: 'forbidden' } };
  }
  const guide = await readGuide(input.guide);
  if (guide === null) {
    return { status: 404, body: { error: 'not_found' } };
  }
  return { status: 200, body: guide };
}

async function isGuideAllowed(
  auth: AuthenticatedContext,
  permissionRepository: PermissionRepository,
  guide: GuideId,
): Promise<boolean> {
  if (guide === 'user') return true;
  const decision = await resolveAuthorization({
    repository: permissionRepository,
    request: {
      organizationId: auth.user.organizationId,
      userId: auth.user.id,
      module: 'roles_permissions',
      action: 'view',
    },
  });
  return decision.allowed;
}
