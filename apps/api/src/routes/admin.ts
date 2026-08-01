import {
  permissionCatalog,
  dataScopes,
  resolveAuthorization,
  type PermissionRepository,
} from '@falcon/permission-engine';

import type { AuthenticatedContext } from '../auth/middleware.js';
import type { AuthConfig } from '../auth/config.js';
import type { EmailSender } from '../auth/password-reset.js';
import { isAdminError } from '../admin/errors.js';
import type { AdminRepository } from '../admin/repository.js';
import { AdminService } from '../admin/service.js';

export interface AdminRouteDeps {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  adminRepository: AdminRepository;
  emailSender: EmailSender;
  authConfig: AuthConfig;
}
export type AdminRouteResult =
  | { status: 200 | 201; body: unknown }
  | { status: 400 | 403 | 404 | 409; body: { error: string; details?: Record<string, unknown> } };

export async function adminRoute(
  input: AdminRouteDeps & {
    module: 'users' | 'roles_permissions';
    action: 'view' | 'create' | 'edit' | 'deactivate';
    work: (service: AdminService) => Promise<unknown>;
    created?: boolean;
  },
): Promise<AdminRouteResult> {
  const decision = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module: input.module,
      action: input.action,
    },
  });
  if (!decision.allowed) return { status: 403, body: { error: 'forbidden' } };
  try {
    const value = await input.work(
      new AdminService(input.adminRepository, input.emailSender, input.authConfig),
    );
    if (value === null) return { status: 404, body: { error: 'not_found' } };
    return { status: input.created ? 201 : 200, body: value };
  } catch (error) {
    if (!isAdminError(error)) throw error;
    return {
      status: error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400,
      body: {
        error: error.code,
        ...(Object.keys(error.details).length ? { details: error.details } : {}),
      },
    };
  }
}

export function permissionCatalogBody() {
  return { modules: permissionCatalog, supportedScopes: dataScopes };
}
