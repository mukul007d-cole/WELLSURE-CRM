import type { LeadActivityWriter } from './activity.js';
import { LeadError } from './errors.js';
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
  ): Promise<{ id: string; active: boolean } | null>;
  listFieldSettings(organizationId: string, journeyId: string): Promise<LeadFieldSetting[]>;
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
  }): Promise<LeadProcessRecord>;
  updateProcessInstanceJourney(
    organizationId: string,
    processInstanceId: string,
    patch: { journeyId: string; currentStatusId: string },
  ): Promise<LeadProcessRecord | null>;
  updateProcessInstanceStatus(
    organizationId: string,
    processInstanceId: string,
    statusId: string,
  ): Promise<LeadProcessRecord | null>;
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
      const settings = await tx.listFieldSettings(input.organizationId, input.journeyId);
      const mergedFieldValues = validateFieldValues({
        settings,
        fieldValues: input.fieldValues,
        statusId: status.id,
      });
      const lead =
        input.existingLeadId === undefined
          ? await tx.createLead({
              organizationId: input.organizationId,
              name: validateNonBlank(input.name, 'lead name'),
              phone: input.phone ?? null,
              email: input.email ?? null,
              fieldValues: mergedFieldValues,
            })
          : await this.attachExistingLead(tx, input, mergedFieldValues);
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
      });
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

      const moved = await requireFound(
        tx.updateProcessInstanceJourney(input.organizationId, process.id, {
          journeyId: input.targetJourneyId,
          currentStatusId: status.id,
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
        newValue: { journeyId: input.targetJourneyId, statusId: status.id },
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
      if (statusId !== oldStatusId) {
        updatedProcess = await requireFound(
          tx.updateProcessInstanceStatus(input.organizationId, process.id, statusId),
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
        });
      }
      if (statusId !== oldStatusId) {
        await tx.writeActivity({
          organizationId: input.organizationId,
          leadId: lead.id,
          processInstanceId: process.id,
          actorUserId: input.actorUserId,
          actionType: 'status_change',
          source: 'lead_api',
          oldValue: { statusId: oldStatusId },
          newValue: { statusId },
        });
      }
      return { lead: updatedLead, process: updatedProcess };
    });
  }

  private async attachExistingLead(
    tx: LeadRepository,
    input: {
      organizationId: string;
      existingLeadId?: string;
      name: string;
      phone?: string | null;
      email?: string | null;
    },
    fieldValues: Record<string, unknown>,
  ): Promise<LeadCoreRecord> {
    const existing = await tx.findLead(input.organizationId, input.existingLeadId!);
    if (existing === null) throw new LeadError('not_found', 'lead not found');
    return requireFound(
      tx.updateLead(input.organizationId, existing.id, {
        name: validateNonBlank(input.name, 'lead name'),
        phone: input.phone ?? existing.phone,
        email: input.email ?? existing.email,
        fieldValues: { ...existing.fieldValues, ...fieldValues },
      }),
    );
  }
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
