import type { FalconPrismaClient } from '@falcon/database';
import { createTimedAccessGrant } from './access-grants.js';

type Tx = FalconPrismaClient;

/** Phase 21 Part 2 — fixed, not admin- or user-configurable. */
export const reassignmentGraceDays = 30 as const;

/**
 * Called from inside the same transaction as a genuine reassignment — the
 * exact two places `assignments.is_current` flips to a *different* user
 * (`LeadSharingService.reassign()`, `StatusRoutingService.assign()`) — never
 * from a general-purpose "did anything about this lead change" hook. A
 * reassignment onto the same holder, or an assignment with no previous
 * holder at all, is not what this checks: there is no "previous owner" to
 * grant anything to.
 *
 * Applies uniformly to every `assignmentType`, not a designated "owner"
 * type — this system has no such concept (Phase 9), and inventing one here
 * would be new product scope, not a narrower reading of what exists. See
 * the plan doc's explicit decision.
 *
 * Eligibility (the outgoing holder's own opt-in, *and* their current Role
 * holding `leads:retain_view_after_reassignment`) is evaluated fresh, right
 * now, against live rows — never against whatever was true when the opt-in
 * was switched on. If eligibility is later revoked, grants already created
 * under it are honored to their natural expiry, not retroactively pulled
 * (see the plan doc's decision) — this function plays no part in that
 * question at all, since it only ever runs at the moment of a new
 * reassignment.
 */
export async function maybeGrantReassignmentGrace(
  tx: Tx,
  input: {
    organizationId: string;
    leadId: string;
    actorUserId: string;
    previousUserId: string | null;
    newUserId: string;
  },
): Promise<void> {
  if (input.previousUserId === null || input.previousUserId === input.newUserId) return;

  const previous = await tx.user.findFirst({
    where: { organizationId: input.organizationId, id: input.previousUserId, active: true },
    select: {
      id: true,
      retainViewAfterReassignment: true,
      roleId: true,
      role: { select: { active: true } },
    },
  });
  if (previous === null || !previous.retainViewAfterReassignment || !previous.role.active) return;

  const eligible = await tx.rolePermission.findFirst({
    where: {
      organizationId: input.organizationId,
      roleId: previous.roleId,
      module: 'leads',
      action: 'retain_view_after_reassignment',
    },
  });
  if (eligible === null) return;

  // Already has standing view access on this lead (an earlier grace grant
  // still running, or an unrelated manual share) — nothing to add, and
  // deliberately not renewed: extending someone else's manually-configured
  // share's expiry as a side effect of this reassignment would be a
  // surprising action-at-a-distance.
  const existing = await tx.userAccessGrant.findFirst({
    where: {
      organizationId: input.organizationId,
      leadId: input.leadId,
      userId: previous.id,
      revokedAt: null,
      actions: { has: 'view' },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (existing !== null) return;

  const grant = await createTimedAccessGrant(tx, {
    organizationId: input.organizationId,
    leadId: input.leadId,
    userId: previous.id,
    grantedByUserId: input.actorUserId,
    actions: ['view'],
    durationDays: reassignmentGraceDays,
  });
  // The same `share_changed` shape `LeadSharingService.create()` writes for
  // a human-initiated share, distinguished by `automatic`/`reason` so the
  // Lead's own timeline reads clearly, alongside the `reassignment` entry
  // the caller (either reassignment path) writes in this same transaction.
  await tx.activityLog.create({
    data: {
      organizationId: input.organizationId,
      leadId: input.leadId,
      actorUserId: input.actorUserId,
      actionType: 'share_changed',
      source: 'lead_api',
      newValue: {
        shareId: grant.id,
        userId: previous.id,
        capabilities: ['view'],
        durationDays: reassignmentGraceDays,
        expiresAt: grant.expiresAt?.toISOString() ?? null,
        automatic: true,
        reason: 'reassignment_grace_period',
      },
    },
  });
}
