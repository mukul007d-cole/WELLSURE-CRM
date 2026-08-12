import type { FalconPrismaClient } from '@falcon/database';

import {
  enteredStatusId,
  type TriggerConsumer,
  type TriggerDispatcher,
  type TriggerEvent,
} from '../leads/trigger-dispatch.js';
import { pick, type Candidate, type RoutingAlgorithm } from './algorithms.js';

export type SkipReason =
  'no_rule' | 'inactive_team' | 'empty_pool' | 'no_active_candidate' | 'unknown_process';

export interface RoutingOutcome {
  assignedUserId: string;
  previousUserId: string | null;
}

/**
 * Assigns a lead when its process instance enters a routed Status.
 *
 * The third consumer of the shared trigger detection (ADR-0013, ADR-0015). It
 * ignores every trigger except `status_changed` and matches the entered status
 * id **exactly**, per ADR-0001 — `sort_order` is display ordering and is never
 * consulted.
 *
 * Runs inside the mutation transaction, like the other two consumers.
 */
export class StatusRoutingService implements TriggerConsumer {
  constructor(
    private readonly prisma: FalconPrismaClient,
    /**
     * Used to dispatch the `reassignment` activity routing itself writes, so an
     * automatic assignment reaches Notification Rules exactly like a manual one.
     * Optional so a caller can construct the service without wiring a cycle.
     */
    private readonly dispatcher?: TriggerDispatcher,
  ) {}

  async evaluate(event: TriggerEvent): Promise<void> {
    if (event.triggerType !== 'status_changed') return;
    const statusId = enteredStatusId(event.newValue);
    if (statusId === null || !event.processInstanceId) return;
    await this.route({
      organizationId: event.organizationId,
      statusId,
      leadId: event.leadId,
      processInstanceId: event.processInstanceId,
      actorUserId: event.actorUserId,
      source: 'routing',
    });
  }

  /**
   * Apply a Status's rule to one process instance.
   *
   * Shared by the automatic path above and the manual override endpoint, so a
   * human-triggered assignment and a rule-triggered one leave identical
   * evidence: one ended assignment, one new assignment, one `reassignment`
   * activity naming both holders.
   */
  async route(input: {
    organizationId: string;
    statusId: string;
    leadId: string;
    processInstanceId: string;
    actorUserId: string;
    source: string;
    /** Manual override target. Bypasses the algorithm, never the supersession. */
    overrideUserId?: string;
  }): Promise<RoutingOutcome | { skipped: SkipReason }> {
    const rule = await this.lockRule(input.organizationId, input.statusId);
    if (rule === null) return this.skip(input, 'no_rule');

    const chosen =
      input.overrideUserId === undefined
        ? await this.choose(rule)
        : { userId: input.overrideUserId, reason: null as SkipReason | null };
    if (chosen.userId === null) return this.skip(input, chosen.reason ?? 'empty_pool');

    return this.assign({ ...input, rule, userId: chosen.userId });
  }

  /**
   * `SELECT … FOR UPDATE` on the rule row before anything reads its cursor or
   * counts its candidates' load.
   *
   * Round robin's cursor is shared mutable state and least loaded's counts are
   * invalidated by the pick that is about to happen, so both are wrong under
   * concurrency for the same reason and both take the same lock. Two status
   * changes through one rule serialize; two through different rules do not.
   */
  private async lockRule(organizationId: string, statusId: string) {
    const found = await this.prisma.statusRoutingRule.findFirst({
      where: { organizationId, statusId, active: true },
      select: { id: true },
    });
    if (!found) return null;
    await this.prisma.$queryRawUnsafe(
      'SELECT id FROM status_routing_rules WHERE organization_id = $1::uuid AND id = $2::uuid FOR UPDATE',
      organizationId,
      found.id,
    );
    // Re-read inside the lock: another transaction may have deactivated or
    // re-pointed the rule between the lookup and the lock being granted.
    return this.prisma.statusRoutingRule.findFirst({
      where: { organizationId, id: found.id, active: true },
    });
  }

  private async choose(rule: {
    id: string;
    organizationId: string;
    algorithm: string;
    poolType: string;
    teamId: string | null;
    assignmentType: string;
    cursorUserId: string | null;
  }): Promise<{ userId: string | null; reason: SkipReason | null }> {
    const poolUserIds = await this.poolUserIds(rule);
    if (poolUserIds === null) return { userId: null, reason: 'inactive_team' };
    if (poolUserIds.length === 0) return { userId: null, reason: 'empty_pool' };

    // A pool member who has since been deactivated is not a candidate. Team
    // pools are already protected by 14a's cascade; a user pool is not, and
    // either way the check belongs at the point of use.
    const active = await this.prisma.user.findMany({
      where: { organizationId: rule.organizationId, id: { in: poolUserIds }, active: true },
      select: { id: true },
    });
    if (active.length === 0) return { userId: null, reason: 'no_active_candidate' };

    const candidates = await this.withLoad(
      rule,
      active.map((user) => user.id),
    );
    return {
      userId: pick(rule.algorithm as RoutingAlgorithm, candidates, rule.cursorUserId),
      reason: null,
    };
  }

  /** Null means the pool cannot be resolved at all (an inactive Team). */
  private async poolUserIds(rule: {
    id: string;
    organizationId: string;
    poolType: string;
    teamId: string | null;
  }): Promise<string[] | null> {
    if (rule.poolType === 'team') {
      const team = await this.prisma.team.findFirst({
        where: { organizationId: rule.organizationId, id: rule.teamId ?? '', active: true },
        select: { id: true },
      });
      if (!team) return null;
      const members = await this.prisma.teamMember.findMany({
        where: { organizationId: rule.organizationId, teamId: team.id },
        select: { userId: true },
      });
      return members.map((member) => member.userId);
    }
    const members = await this.prisma.statusRoutingRuleMember.findMany({
      where: { organizationId: rule.organizationId, ruleId: rule.id },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }

  /**
   * Each candidate's open load.
   *
   * "Open" is: a current assignment, of *this rule's* assignment type, on an
   * active process instance whose current status has `outcome_type = 'open'`,
   * counted organization-wide.
   *
   * Each clause is a decision (ADR-0015): a rep holding two hundred closed-won
   * leads is not loaded; being a collaborator on a different assignment type is
   * not this rule's business; and a rep working two Journeys is genuinely busy
   * in both, so scoping the count to one Journey would keep feeding leads to
   * someone already buried in another. `behavior_type: archived` is *not*
   * excluded — it is a view default, not a statement that the work is finished.
   */
  private async withLoad(
    rule: { organizationId: string; assignmentType: string; algorithm: string },
    userIds: readonly string[],
  ): Promise<Candidate[]> {
    if (rule.algorithm !== 'least_loaded')
      return userIds.map((userId) => ({ userId, openCount: 0 }));
    const counts = await this.prisma.assignment.groupBy({
      by: ['userId'],
      where: {
        organizationId: rule.organizationId,
        isCurrent: true,
        assignmentType: rule.assignmentType,
        userId: { in: [...userIds] },
        processInstance: { active: true, currentStatus: { outcomeType: 'open' } },
      },
      _count: { _all: true },
    });
    const byUser = new Map(counts.map((row) => [row.userId, row._count._all]));
    return userIds.map((userId) => ({ userId, openCount: byUser.get(userId) ?? 0 }));
  }

  /**
   * End the current assignment for this type, create the replacement, record
   * both — one transaction, one activity, never two live assignments.
   *
   * This mirrors `LeadSharingService.reassign` deliberately. SELF scope resolves
   * through `assignments.is_current`, so setting the old row false is precisely
   * what removes the previous holder's access; nothing else has to change.
   */
  private async assign(input: {
    organizationId: string;
    leadId: string;
    processInstanceId: string;
    actorUserId: string;
    source: string;
    userId: string;
    rule: { id: string; assignmentType: string };
  }): Promise<RoutingOutcome> {
    const previous = await this.prisma.assignment.findFirst({
      where: {
        organizationId: input.organizationId,
        processInstanceId: input.processInstanceId,
        assignmentType: input.rule.assignmentType,
        isCurrent: true,
      },
    });

    if (previous && previous.userId === input.userId) {
      // Already held by the chosen user. Moving the cursor still matters, so the
      // next lead does not land on them again, but churning the assignment row
      // would put a meaningless reassignment in the lead's timeline.
      await this.advanceCursor(input.organizationId, input.rule.id, input.userId);
      return { assignedUserId: input.userId, previousUserId: previous.userId };
    }

    if (previous)
      await this.prisma.assignment.update({
        where: { organizationId_id: { organizationId: input.organizationId, id: previous.id } },
        data: { isCurrent: false },
      });

    await this.prisma.assignment.create({
      data: {
        organizationId: input.organizationId,
        processInstanceId: input.processInstanceId,
        assignmentType: input.rule.assignmentType,
        userId: input.userId,
      },
    });
    await this.advanceCursor(input.organizationId, input.rule.id, input.userId);

    /*
     * `reassignment` even when there was no previous holder, with
     * `oldValue.userId: null`.
     *
     * A new action type would have to be taught to the timeline renderer and to
     * Phase 9's `previous_assignment_holder` resolver, which reads exactly
     * `oldValue.userId` off this row. Reusing the shape keeps both working.
     */
    const oldValue = {
      assignmentType: input.rule.assignmentType,
      userId: previous?.userId ?? null,
    };
    const newValue = { assignmentType: input.rule.assignmentType, userId: input.userId };
    const activity = await this.prisma.activityLog.create({
      data: {
        organizationId: input.organizationId,
        leadId: input.leadId,
        processInstanceId: input.processInstanceId,
        actorUserId: input.actorUserId,
        actionType: 'reassignment',
        source: input.source,
        oldValue,
        newValue,
      },
    });

    // Dispatched, not written directly to one consumer: an automatic assignment
    // reaches the same rules a manual one does. Routing ignores
    // `lead_reassigned`, so this terminates in one hop.
    await this.dispatcher?.dispatch({
      organizationId: input.organizationId,
      activityLogId: activity.id,
      leadId: input.leadId,
      processInstanceId: input.processInstanceId,
      actorUserId: input.actorUserId,
      triggerType: 'lead_reassigned',
      oldValue,
      newValue,
    });

    return { assignedUserId: input.userId, previousUserId: previous?.userId ?? null };
  }

  private async advanceCursor(organizationId: string, ruleId: string, userId: string) {
    await this.prisma.statusRoutingRule.update({
      where: { organizationId_id: { organizationId, id: ruleId } },
      data: { cursorUserId: userId },
    });
  }

  /**
   * A rule that cannot produce a candidate is a configuration condition, not a
   * fault (ADR-0015).
   *
   * The status change commits; the lead keeps whatever assignment it had; the
   * skip is recorded so an admin can see it happened rather than wondering why
   * nothing was assigned. Throwing here would let an empty pool reject an
   * ordinary user's status change, which is strictly worse. A genuine fault — a
   * database error — still throws and still rolls the mutation back.
   */
  private async skip(
    input: {
      organizationId: string;
      leadId: string;
      processInstanceId: string;
      actorUserId: string;
    },
    reason: SkipReason,
  ): Promise<{ skipped: SkipReason }> {
    if (reason !== 'no_rule')
      await this.prisma.activityLog.create({
        data: {
          organizationId: input.organizationId,
          leadId: input.leadId,
          processInstanceId: input.processInstanceId,
          actorUserId: input.actorUserId,
          actionType: 'routing_skipped',
          source: 'routing',
          newValue: { reason },
        },
      });
    return { skipped: reason };
  }
}
