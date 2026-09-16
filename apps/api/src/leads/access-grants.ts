import type { FalconPrismaClient } from '@falcon/database';

/**
 * Phase 21 Part 1. A fixed set, required on every share going forward — no
 * "permanent" option. The prior behavior (no duration parameter at all,
 * `expiresAt` always left `null`) can't silently continue once expiry is a
 * feature the person creating the share is asked to choose; see the plan
 * doc's explicit decision. `createTimedAccessGrant` below is the single
 * place `durationDays` becomes a real `expiresAt` — never trust a
 * client-supplied timestamp for this.
 */
export const shareDurationsDays = [7, 30, 60] as const;
export type ShareDurationDays = (typeof shareDurationsDays)[number];

type Tx = FalconPrismaClient;

/**
 * The one place a timed `user_access_grants` row is constructed — reused by
 * both Part 1 (`LeadSharingService.create()`, a human choosing a duration
 * when sharing a lead) and Part 2 (`reassignment-grace.ts`, the system
 * creating a fixed 30-day view-only grant at reassignment). One function
 * computing `expiresAt` from a validated duration, not two independent call
 * sites that could drift. Lives in its own module, separate from both
 * callers, so neither has to import the other.
 */
export async function createTimedAccessGrant(
  tx: Tx,
  input: {
    organizationId: string;
    leadId: string;
    userId: string;
    grantedByUserId: string;
    actions: readonly string[];
    durationDays: ShareDurationDays;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + input.durationDays * 24 * 60 * 60 * 1000);
  return tx.userAccessGrant.create({
    data: {
      organizationId: input.organizationId,
      leadId: input.leadId,
      userId: input.userId,
      grantedByUserId: input.grantedByUserId,
      actions: [...input.actions],
      expiresAt,
    },
  });
}
