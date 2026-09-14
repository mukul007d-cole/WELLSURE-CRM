import type { PermissionRepository } from '@falcon/permission-engine';

/**
 * Phase 21 Part 2 — the personal, self-service opt-in to keep view-only
 * access to a lead for 30 days after being reassigned off it.
 */
export interface PreferencesRepository {
  setRetainViewAfterReassignment(input: {
    userId: string;
    organizationId: string;
    value: boolean;
    changedAt: Date;
  }): Promise<void>;
}

/**
 * Turning the opt-in *on* requires the caller's current Role to hold
 * `leads:retain_view_after_reassignment` — re-checked here, live, rather
 * than trusted from whatever the Settings page decided to show or hide
 * (the API enforces authorization, the UI only reflects it, per
 * `AGENTS.md`). Turning it *off* is always allowed regardless of
 * eligibility, since it only narrows exposure.
 */
export async function updateReassignmentGracePreference(input: {
  repository: PreferencesRepository;
  permissionRepository: Pick<PermissionRepository, 'getRolePermission'>;
  userId: string;
  organizationId: string;
  roleId: string;
  value: boolean;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; reason: 'ineligible' }> {
  if (input.value) {
    const permission = await input.permissionRepository.getRolePermission({
      roleId: input.roleId,
      organizationId: input.organizationId,
      module: 'leads',
      action: 'retain_view_after_reassignment',
    });
    if (permission === null) return { ok: false, reason: 'ineligible' };
  }
  await input.repository.setRetainViewAfterReassignment({
    userId: input.userId,
    organizationId: input.organizationId,
    value: input.value,
    changedAt: input.now ?? new Date(),
  });
  return { ok: true };
}
