import { resolveAuthorization, type PermissionRepository } from '@falcon/permission-engine';

import type { AuthenticatedContext } from '../auth/middleware.js';
import { isConfigurationError, type ConfigurationError } from '../configuration/errors.js';
import { purgeDescriptors, type PurgeEntity } from '../configuration/purge.js';
import type { PurgeService } from '../configuration/purge-service.js';
import type { ConfigurationRouteResult } from './configuration.js';

/**
 * Bounded hard-delete. One route function for all seven entity types, because
 * the shape is identical and the difference between them is data — the
 * descriptor table in `configuration/purge.ts` — not control flow.
 *
 * **The authorization request carries no `journeyId`, deliberately.** It is the
 * same choice `readConfiguration` makes and for the same reason: journey access
 * gates which Leads a role reaches, and this is the configuration catalog, not
 * a record. The journey axis was already enforced when the entity was
 * deactivated, which purge requires first, and `purge` is itself a distinct
 * grant an administrator has to hand out on purpose — bootstrap does not.
 */
export async function purgeEntity(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  purgeService: PurgeService;
  entity: PurgeEntity;
  id: string;
  now?: Date;
}): Promise<ConfigurationRouteResult> {
  const decision = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module: purgeDescriptors[input.entity].module,
      action: 'purge',
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  });
  if (!decision.allowed) return { status: 403, body: { error: 'forbidden' } };

  try {
    return {
      status: 200,
      body: await input.purgeService.purge({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        entity: input.entity,
        id: input.id,
      }),
    };
  } catch (error) {
    if (!isConfigurationError(error)) throw error;
    return toResponse(error);
  }
}

function toResponse(error: ConfigurationError): ConfigurationRouteResult {
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
