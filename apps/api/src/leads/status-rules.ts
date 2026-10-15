import type { PermissionRepository } from '@falcon/permission-engine';

import { LeadError } from './errors.js';

/**
 * ADR-0026 status rules, as the lead service sees them.
 *
 * - `allowedRoleIds` — who may *choose* the status. Empty = unrestricted.
 * - `requiredFieldIds` — Fields that must hold a value to *enter* it.
 * - `reasonOptions` — the reasons a user may record on entry. Empty = none.
 */
export interface StatusRules {
  allowedRoleIds: readonly string[];
  requiredFieldIds: readonly string[];
  reasonOptions: readonly string[];
}

export const noStatusRules: StatusRules = {
  allowedRoleIds: [],
  requiredFieldIds: [],
  reasonOptions: [],
};

/** Who is acting, for the role-based rules. Absent = a system path, exempt. */
export interface LeadActor {
  roleId: string;
  /** Holds `leads:bypass_status_rules`: the allow-list does not apply. */
  bypassStatusRules: boolean;
}

export const bypassStatusRulesAction = 'bypass_status_rules' as const;

/** Resolves the acting user's role and status-rule bypass from the real grants. */
export async function resolveLeadActor(
  permissionRepository: PermissionRepository,
  user: { organizationId: string; roleId: string },
): Promise<LeadActor> {
  const bypass = await permissionRepository.getRolePermission({
    organizationId: user.organizationId,
    roleId: user.roleId,
    module: 'leads',
    action: bypassStatusRulesAction,
  });
  return { roleId: user.roleId, bypassStatusRules: bypass !== null };
}

/**
 * Entry into a status. Three checks, in this order:
 *
 * 1. **Allowed roles** — only when the request *chose* the status. Landing in
 *    a journey's default status on create is never blocked, and system moves
 *    pass no actor.
 * 2. **Reason** — must be one of the status's configured reasons.
 * 3. **Required fields** — must hold a value in the lead's merged values. Every
 *    missing id is reported at once so the client can prompt for all of them.
 */
export function enforceStatusEntry(input: {
  statusId: string;
  rules: StatusRules;
  actor: LeadActor | undefined;
  chosen: boolean;
  reason: string | null | undefined;
  fieldValues: Readonly<Record<string, unknown>>;
}): string | null {
  const { rules, actor } = input;
  if (
    input.chosen &&
    actor !== undefined &&
    !actor.bypassStatusRules &&
    rules.allowedRoleIds.length > 0 &&
    !rules.allowedRoleIds.includes(actor.roleId)
  ) {
    throw new LeadError('forbidden', 'your role may not move a lead into this status', {
      statusId: input.statusId,
    });
  }

  const reason = normalizeReason(input.reason);
  if (reason !== null && !rules.reasonOptions.includes(reason)) {
    throw new LeadError('validation_error', 'status reason is not one of the configured options', {
      statusId: input.statusId,
    });
  }

  const missing = rules.requiredFieldIds.filter((fieldId) => isBlank(input.fieldValues[fieldId]));
  if (missing.length > 0) {
    throw new LeadError('validation_error', 'this status requires more fields', {
      statusId: input.statusId,
      fieldIds: missing,
    });
  }
  return reason;
}

export function normalizeReason(reason: string | null | undefined): string | null {
  if (reason === undefined || reason === null) return null;
  const trimmed = reason.trim();
  return trimmed === '' ? null : trimmed;
}

function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}
