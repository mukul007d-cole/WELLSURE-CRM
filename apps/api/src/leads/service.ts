import type { LeadActivityWriter } from './activity.js';
import { LeadError } from './errors.js';
import {
  enforceStatusEntry,
  normalizeReason,
  type LeadActor,
  type StatusRules,
} from './status-rules.js';
import {
  validateAssignments,
  validateFieldValues,
  validateNonBlank,
  type LeadFieldSetting,
} from './validation.js';

export interface LeadCoreRecord {
  id: string;
  organizationId: string;
  name: string;
  phone: string | null;
  email: string | null;
  fieldValues: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface LeadProcessRecord {
  id: string;
  organizationId: string;
  leadId: string;
  journeyId: string;
  currentStatusId: string;
  isPrimary: boolean;
  active: boolean;
  journey?: { id: string; name: string; key: string };
  currentStatus?: { id: string; name: string; key: string };
  assignments?: LeadAssignmentRecord[];
}

export interface LeadAssignmentRecord {
  id: string;
  organizationId: string;
  processInstanceId: string;
  assignmentType: string;
  userId: string;
  isCurrent: boolean;
  userName: string | null;
}

/** ADR-0026 — a follow-up as the lead service schedules it. */
export interface FollowUpInput {
  dueAt: Date;
  note?: string | null;
  /** Defaults to the acting user. */
  assignedToUserId?: string;
}

export interface FollowUpRecord {
  id: string;
  processInstanceId: string | null;
  assignedToUserId: string;
  dueDate: Date;
  status: string;
  note: string | null;
}

export interface LeadRepository extends LeadActivityWriter {
  transaction<T>(work: (repository: LeadRepository) => Promise<T>): Promise<T>;
  findJourney(
    organizationId: string,
    journeyId: string,
  ): Promise<{ id: string; active: boolean } | null>;
  findStatus(
    organizationId: string,
    journeyId: string,
    statusId: string,
  ): Promise<{ id: string; active: boolean; isDefaultOnCreate?: boolean } | null>;
  findDefaultStatus(
    organizationId: string,
    journeyId: string,
  ): Promise<{ id: string; active: boolean; isDefaultOnCreate?: boolean } | null>;
  listFieldSettings(organizationId: string, journeyId: string): Promise<LeadFieldSetting[]>;
  /** ADR-0026 — allowed roles, required-on-entry fields and reasons. */
  getStatusRules(organizationId: string, statusId: string): Promise<StatusRules>;
  findLead(organizationId: string, leadId: string): Promise<LeadCoreRecord | null>;
  findProcessInstance(
    organizationId: string,
    processInstanceId: string,
  ): Promise<LeadProcessRecord | null>;
  findActiveProcessInstanceByLeadJourney(
    organizationId: string,
    leadId: string,
    journeyId: string,
  ): Promise<LeadProcessRecord | null>;
  createLead(input: {
    organizationId: string;
    name: string;
    phone: string | null;
    email: string | null;
    fieldValues: Record<string, unknown>;
  }): Promise<LeadCoreRecord>;
  updateLead(
    organizationId: string,
    leadId: string,
    input: Partial<Pick<LeadCoreRecord, 'name' | 'phone' | 'email' | 'fieldValues'>>,
  ): Promise<LeadCoreRecord | null>;
  createProcessInstance(input: {
    organizationId: string;
    leadId: string;
    journeyId: string;
    currentStatusId: string;
    isPrimary: boolean;
    statusReason?: string | null;
  }): Promise<LeadProcessRecord>;
  updateProcessInstanceJourney(
    organizationId: string,
    processInstanceId: string,
    patch: { journeyId: string; currentStatusId: string; statusReason?: string | null },
  ): Promise<LeadProcessRecord | null>;
  /** Sets the status and its reason together: a status change clears the old reason. */
  updateProcessInstanceStatus(
    organizationId: string,
    processInstanceId: string,
    statusId: string,
    statusReason?: string | null,
  ): Promise<LeadProcessRecord | null>;
  /** Closes every open follow-up on the instance; returns how many. */
  closeOpenFollowUps(input: {
    organizationId: string;
    processInstanceId: string;
    status: 'rescheduled' | 'cancelled';
    actorUserId: string;
    at: Date;
  }): Promise<number>;
  createFollowUp(input: {
    organizationId: string;
    leadId: string;
    processInstanceId: string;
    assignedToUserId: string;
    dueDate: Date;
    note: string | null;
    createdFromStatusId: string | null;
    source: string;
  }): Promise<FollowUpRecord>;
  createAssignment(input: {
    organizationId: string;
    processInstanceId: string;
    assignmentType: string;
    userId: string;
  }): Promise<LeadAssignmentRecord>;
  userExists(organizationId: string, userId: string): Promise<boolean>;
}

export class LeadService {
  constructor(private readonly repository: LeadRepository) {}

  async createLead(input: {
    organizationId: string;
    actorUserId: string;
    journeyId: string;
    statusId?: string;
    existingLeadId?: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    fieldValues: Record<string, unknown>;
    assignments: readonly { assignmentType: string; userId: string }[];
    /** ADR-0026 — the acting user's role; absent on system paths. */
    actor?: LeadActor;
    statusReason?: string | null;
    followUp?: FollowUpInput;
  }) {
    return this.repository.transaction(async (tx) => {
      const assignments = validateAssignments(input.assignments);
      await validateAssignmentUsers(tx, input.organizationId, assignments);
      const journey = await tx.findJourney(input.organizationId, input.journeyId);
      if (journey === null || !journey.active)
        throw new LeadError('not_found', 'journey not found');
      const status =
        input.statusId === undefined
          ? await tx.findDefaultStatus(input.organizationId, input.journeyId)
          : await tx.findStatus(input.organizationId, input.journeyId, input.statusId);
      if (status === null || !status.active)
        throw new LeadError('validation_error', 'status is invalid');

      // Fetched *before* validating, when reusing a lead: a locked field can
      // only be protected against a client-supplied change by checking what
      // it already holds, and a calculated field can only be recomputed
      // correctly from the record's real existing values, not from nothing.
      // Fetching first also means the required-field completeness check
      // below sees the lead's actual state rather than only the values this
      // one call happens to submit.
      const existingLead =
        input.existingLeadId === undefined
          ? null
          : await requireLead(tx, input.organizationId, input.existingLeadId);

      const settings = await tx.listFieldSettings(input.organizationId, input.journeyId);
      const mergedFieldValues = validateFieldValues({
        settings,
        fieldValues: input.fieldValues,
        ...(existingLead === null ? {} : { existingFieldValues: existingLead.fieldValues }),
        statusId: status.id,
        creation: input.actor === undefined ? {} : { actorRoleId: input.actor.roleId },
      });
      // Landing in the journey's default status is never "choosing" one: a
      // role that may add leads but not pick a status must still be able to add.
      const statusReason = enforceStatusEntry({
        statusId: status.id,
        rules: await tx.getStatusRules(input.organizationId, status.id),
        actor: input.actor,
        chosen: input.statusId !== undefined && status.isDefaultOnCreate !== true,
        reason: input.statusReason,
        fieldValues: mergedFieldValues,
      });
      const lead =
        existingLead === null
          ? await tx.createLead({
              organizationId: input.organizationId,
              name: validateNonBlank(input.name, 'lead name'),
              phone: input.phone ?? null,
              email: input.email ?? null,
              fieldValues: mergedFieldValues,
            })
          : await requireFound(
              tx.updateLead(input.organizationId, existingLead.id, {
                name: validateNonBlank(input.name, 'lead name'),
                phone: input.phone ?? existingLead.phone,
                email: input.email ?? existingLead.email,
                fieldValues: mergedFieldValues,
              }),
            );
      const duplicate = await tx.findActiveProcessInstanceByLeadJourney(
        input.organizationId,
        lead.id,
        input.journeyId,
      );
      if (duplicate !== null) {
        throw new LeadError(
          'dependency_conflict',
          'lead already has an active process instance for this journey',
        );
      }
      const process = await tx.createProcessInstance({
        organizationId: input.organizationId,
        leadId: lead.id,
        journeyId: input.journeyId,
        currentStatusId: status.id,
        isPrimary: false,
        statusReason,
      });
      for (const assignment of assignments) {
        await tx.createAssignment({
          organizationId: input.organizationId,
          processInstanceId: process.id,
          assignmentType: assignment.assignmentType,
          userId: assignment.userId,
        });
      }
      await tx.writeActivity({
        organizationId: input.organizationId,
        leadId: lead.id,
        processInstanceId: process.id,
        actorUserId: input.actorUserId,
        actionType: 'field_edit',
        source: 'lead_api',
        oldValue: null,
        newValue: {
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          fieldValues: mergedFieldValues,
        },
        changedFieldIds: Object.keys(mergedFieldValues),
      });
      if (input.followUp !== undefined) {
        await scheduleFollowUp(tx, {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          leadId: lead.id,
          processInstanceId: process.id,
          statusId: status.id,
          followUp: input.followUp,
        });
      }
      return { lead, process };
    });
  }

  /**
   * Move a process instance to a different journey.
   *
   * The instance keeps its identity — `journeyId` is updated in place rather
   * than the old one being deactivated and a new one created — so assignments,
   * attachments and the instance's own activity history stay attached to one
   * row instead of splitting across two.
   *
   * The lead's name, phone, email and `fieldValues` all live on the lead, not
   * the instance, so they survive a move untouched. What does have to be
   * rechecked is whether they still satisfy the *target* journey's field rules:
   * a lead complete for journey A can be missing something journey B requires.
   */
  async moveJourney(input: {
    organizationId: string;
    actorUserId: string;
    processInstanceId: string;
    targetJourneyId: string;
    statusId?: string;
    actor?: LeadActor;
    statusReason?: string | null;
  }) {
    return this.repository.transaction(async (tx) => {
      const process = await tx.findProcessInstance(input.organizationId, input.processInstanceId);
      if (process === null || !process.active)
        throw new LeadError('not_found', 'process instance not found');
      if (process.journeyId === input.targetJourneyId)
        throw new LeadError('validation_error', 'lead is already in that journey');

      const lead = await tx.findLead(input.organizationId, process.leadId);
      if (lead === null) throw new LeadError('not_found', 'lead not found');

      const journey = await tx.findJourney(input.organizationId, input.targetJourneyId);
      if (journey === null || !journey.active)
        throw new LeadError('not_found', 'target journey not found');

      // The partial unique index enforces this too, but a 409 explaining it
      // beats a constraint violation surfacing as a 500.
      const duplicate = await tx.findActiveProcessInstanceByLeadJourney(
        input.organizationId,
        lead.id,
        input.targetJourneyId,
      );
      if (duplicate !== null)
        throw new LeadError(
          'dependency_conflict',
          'lead already has an active process instance for this journey',
        );

      const status =
        input.statusId === undefined
          ? await tx.findDefaultStatus(input.organizationId, input.targetJourneyId)
          : await tx.findStatus(input.organizationId, input.targetJourneyId, input.statusId);
      if (status === null || !status.active)
        throw new LeadError('validation_error', 'status is invalid for the target journey');

      // Re-validate what the lead already holds against the target's rules.
      // Passing no new values means this checks completeness, not a change.
      const settings = await tx.listFieldSettings(input.organizationId, input.targetJourneyId);
      validateFieldValues({
        settings,
        fieldValues: {},
        existingFieldValues: lead.fieldValues,
        statusId: status.id,
      });
      const statusReason = enforceStatusEntry({
        statusId: status.id,
        rules: await tx.getStatusRules(input.organizationId, status.id),
        actor: input.actor,
        chosen: input.statusId !== undefined && status.isDefaultOnCreate !== true,
        reason: input.statusReason,
        fieldValues: lead.fieldValues,
      });

      const moved = await requireFound(
        tx.updateProcessInstanceJourney(input.organizationId, process.id, {
          journeyId: input.targetJourneyId,
          currentStatusId: status.id,
          statusReason,
        }),
      );
      await tx.writeActivity({
        organizationId: input.organizationId,
        leadId: lead.id,
        processInstanceId: process.id,
        actionType: 'journey_change',
        actorUserId: input.actorUserId,
        source: 'lead_api',
        oldValue: { journeyId: process.journeyId, statusId: process.currentStatusId },
        newValue: {
          journeyId: input.targetJourneyId,
          statusId: status.id,
          ...(statusReason === null ? {} : { reason: statusReason }),
        },
      });
      return { lead, process: moved };
    });
  }

  async editLead(input: {
    organizationId: string;
    actorUserId: string;
    processInstanceId: string;
    name?: string;
    phone?: string | null;
    email?: string | null;
    fieldValues?: Record<string, unknown>;
    statusId?: string;
    actor?: LeadActor;
    statusReason?: string | null;
    followUp?: FollowUpInput;
  }) {
    return this.repository.transaction(async (tx) => {
      const process = await tx.findProcessInstance(input.organizationId, input.processInstanceId);
      if (process === null || !process.active)
        throw new LeadError('not_found', 'process instance not found');
      const lead = await tx.findLead(input.organizationId, process.leadId);
      if (lead === null) throw new LeadError('not_found', 'lead not found');
      const oldStatusId = process.currentStatusId;
      const statusId = input.statusId ?? oldStatusId;
      const status = await tx.findStatus(input.organizationId, process.journeyId, statusId);
      if (status === null || !status.active)
        throw new LeadError('validation_error', 'status is invalid');
      const settings = await tx.listFieldSettings(input.organizationId, process.journeyId);
      const fieldValues = input.fieldValues ?? {};
      const mergedFieldValues = validateFieldValues({
        settings,
        fieldValues,
        existingFieldValues: lead.fieldValues,
        statusId,
      });
      const statusChanges = statusId !== oldStatusId;
      // A reason belongs to a status entry; there is nothing to attach it to
      // when the status stays put.
      if (!statusChanges && normalizeReason(input.statusReason) !== null)
        throw new LeadError('validation_error', 'a status reason needs a status change');
      const statusReason = statusChanges
        ? enforceStatusEntry({
            statusId,
            rules: await tx.getStatusRules(input.organizationId, statusId),
            actor: input.actor,
            chosen: true,
            reason: input.statusReason,
            fieldValues: mergedFieldValues,
          })
        : null;
      const leadPatch = {
        ...(input.name === undefined ? {} : { name: validateNonBlank(input.name, 'lead name') }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.fieldValues === undefined ? {} : { fieldValues: mergedFieldValues }),
      };
      const updatedLead =
        Object.keys(leadPatch).length === 0
          ? lead
          : await requireFound(tx.updateLead(input.organizationId, lead.id, leadPatch));
      let updatedProcess = process;
      if (statusChanges) {
        updatedProcess = await requireFound(
          tx.updateProcessInstanceStatus(input.organizationId, process.id, statusId, statusReason),
        );
      }
      if (Object.keys(leadPatch).length > 0) {
        await tx.writeActivity({
          organizationId: input.organizationId,
          leadId: lead.id,
          processInstanceId: process.id,
          actorUserId: input.actorUserId,
          actionType: 'field_edit',
          source: 'lead_api',
          oldValue: lead,
          newValue: updatedLead,
          // The dynamic Field ids this specific call supplied — never the
          // full merged set, so a rule scoped to Field A doesn't fire when
          // only name/phone/email or an unrelated Field B changed.
          changedFieldIds: Object.keys(fieldValues),
        });
      }
      if (statusChanges) {
        await tx.writeActivity({
          organizationId: input.organizationId,
          leadId: lead.id,
          processInstanceId: process.id,
          actorUserId: input.actorUserId,
          actionType: 'status_change',
          source: 'lead_api',
          oldValue: { statusId: oldStatusId },
          newValue: { statusId, ...(statusReason === null ? {} : { reason: statusReason }) },
        });
      }
      const followUp =
        input.followUp === undefined
          ? null
          : await scheduleFollowUp(tx, {
              organizationId: input.organizationId,
              actorUserId: input.actorUserId,
              leadId: lead.id,
              processInstanceId: process.id,
              statusId,
              followUp: input.followUp,
            });
      return {
        lead: updatedLead,
        process: updatedProcess,
        ...(followUp === null ? {} : { followUp }),
      };
    });
  }
}

/**
 * ADR-0026 — one open follow-up per process instance: scheduling a new one
 * closes the previous as `rescheduled`, then records the new one in the
 * timeline.
 */
async function scheduleFollowUp(
  tx: LeadRepository,
  input: {
    organizationId: string;
    actorUserId: string;
    leadId: string;
    processInstanceId: string;
    statusId: string;
    followUp: FollowUpInput;
  },
): Promise<FollowUpRecord> {
  if (Number.isNaN(input.followUp.dueAt.getTime()))
    throw new LeadError('validation_error', 'follow-up date is invalid');
  const assignedToUserId = input.followUp.assignedToUserId ?? input.actorUserId;
  if (!(await tx.userExists(input.organizationId, assignedToUserId)))
    throw new LeadError('validation_error', 'follow-up user is invalid', {
      userId: assignedToUserId,
    });
  const note = input.followUp.note?.trim() ?? '';
  if (note.length > 2000) throw new LeadError('validation_error', 'follow-up note is too long');
  const closed = await tx.closeOpenFollowUps({
    organizationId: input.organizationId,
    processInstanceId: input.processInstanceId,
    status: 'rescheduled',
    actorUserId: input.actorUserId,
    at: new Date(),
  });
  const task = await tx.createFollowUp({
    organizationId: input.organizationId,
    leadId: input.leadId,
    processInstanceId: input.processInstanceId,
    assignedToUserId,
    dueDate: input.followUp.dueAt,
    note: note === '' ? null : note,
    createdFromStatusId: input.statusId,
    source: 'lead_api',
  });
  await tx.writeActivity({
    organizationId: input.organizationId,
    leadId: input.leadId,
    processInstanceId: input.processInstanceId,
    actorUserId: input.actorUserId,
    actionType: 'follow_up',
    source: 'lead_api',
    oldValue: closed > 0 ? { rescheduled: closed } : null,
    newValue: {
      taskId: task.id,
      dueAt: task.dueDate.toISOString(),
      assignedToUserId,
      ...(task.note === null ? {} : { note: task.note }),
    },
  });
  return task;
}

async function requireLead(
  repository: LeadRepository,
  organizationId: string,
  leadId: string,
): Promise<LeadCoreRecord> {
  const lead = await repository.findLead(organizationId, leadId);
  if (lead === null) throw new LeadError('not_found', 'lead not found');
  return lead;
}

async function validateAssignmentUsers(
  repository: LeadRepository,
  organizationId: string,
  assignments: readonly { assignmentType: string; userId: string }[],
): Promise<void> {
  for (const assignment of assignments) {
    if (!(await repository.userExists(organizationId, assignment.userId))) {
      throw new LeadError('validation_error', 'assignment user is invalid', {
        userId: assignment.userId,
      });
    }
  }
}

async function requireFound<T>(value: Promise<T | null>): Promise<T> {
  const row = await value;
  if (row === null) throw new LeadError('not_found', 'lead record not found');
  return row;
}
