/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from 'vitest';

import { createLead, editLead, getSeller360, listSellers } from '../routes/leads.js';
import type { LeadActivityInput } from '../leads/activity.js';
import type {
  LeadAssignmentRecord,
  LeadCoreRecord,
  LeadProcessRecord,
  LeadRepository,
} from '../leads/service.js';
import type { Seller360Record, SellerListRecord } from '../routes/leads.js';
import type { LeadFieldSetting } from '../leads/validation.js';
import type { PermissionRepository } from '@falcon/permission-engine';

const orgA = '11111111-1111-1111-1111-111111111111';
const orgB = '22222222-2222-2222-2222-222222222222';
const actorId = '33333333-3333-3333-3333-333333333333';
const roleId = '44444444-4444-4444-4444-444444444444';
const journeyA = '55555555-5555-5555-5555-555555555555';
const journeyB = '66666666-6666-6666-6666-666666666666';
const statusEarly = '77777777-7777-7777-7777-777777777777';
const statusRequired = '88888888-8888-8888-8888-888888888888';
const fieldVisible = '99999999-9999-9999-9999-999999999999';
const fieldHidden = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const assignmentType = 'synthetic_assignment_type';
const now = new Date('2026-01-01T00:00:00.000Z');

const auth = {
  session: {
    id: 'session',
    organizationId: orgA,
    userId: actorId,
    tokenHash: 'hash',
    createdAt: now,
    expiresAt: new Date('2026-01-01T08:00:00.000Z'),
    revokedAt: null,
    lastSeenAt: now,
    ipAddress: null,
    userAgent: null,
  },
  user: {
    id: actorId,
    organizationId: orgA,
    roleId,
    active: true,
    departmentId: null,
    managerId: null,
  },
};

describe('Lead/Seller core route and service behavior', () => {
  it('requires explicit caller-supplied assignments and never relies on a hardcoded default', async () => {
    const repo = new MemoryLeadRepository();
    const response = await createLead({
      auth,
      leadRepository: repo,
      permissionRepository: permissionRepository({ assignmentTypes: [] }),
      journeyId: journeyA,
      statusId: statusEarly,
      name: 'Synthetic Seller',
      fieldValues: {},
      assignments: [],
      now,
    });
    expect(response).toEqual({ status: 400, body: { error: 'validation_error' } });
  });

  it('uses exact-match required_from_status_id semantics and ignores status sort order', async () => {
    const repo = new MemoryLeadRepository();
    repo.fieldSettings = [requiredFromField(statusRequired)];
    const early = await createLead({
      auth,
      leadRepository: repo,
      permissionRepository: permissionRepository({ editableFields: [fieldVisible] }),
      journeyId: journeyA,
      statusId: statusEarly,
      name: 'Synthetic Seller',
      fieldValues: {},
      assignments: [{ assignmentType, userId: actorId }],
      now,
    });
    expect(early.status).toBe(201);

    const blocked = await createLead({
      auth,
      leadRepository: repo,
      permissionRepository: permissionRepository({ editableFields: [fieldVisible] }),
      journeyId: journeyA,
      statusId: statusRequired,
      name: 'Synthetic Seller 2',
      fieldValues: {},
      assignments: [{ assignmentType, userId: actorId }],
      now,
    });
    expect(blocked).toEqual({
      status: 400,
      body: { error: 'validation_error', details: { fieldId: fieldVisible } },
    });
  });

  it('creates a lead, process instance, assignment, and activity atomically through caller supplied assignment type', async () => {
    const repo = new MemoryLeadRepository();
    repo.fieldSettings = [optionalField(fieldVisible)];
    const response = await createLead({
      auth,
      leadRepository: repo,
      permissionRepository: permissionRepository({ editableFields: [fieldVisible] }),
      journeyId: journeyA,
      statusId: statusEarly,
      name: 'Synthetic Seller',
      email: 'synthetic@example.test',
      fieldValues: { [fieldVisible]: 'visible value' },
      assignments: [{ assignmentType, userId: actorId }],
      now,
    });
    expect(response.status).toBe(201);
    expect(repo.leads).toHaveLength(1);
    expect(repo.processes).toHaveLength(1);
    expect(repo.assignments).toMatchObject([{ assignmentType, userId: actorId }]);
    expect(repo.activities).toMatchObject([{ actionType: 'field_edit', source: 'lead_api' }]);
  });

  it('blocks status changes that exactly match a missing required-from-status field', async () => {
    const repo = new MemoryLeadRepository();
    repo.fieldSettings = [requiredFromField(statusRequired)];
    const lead = repo.seedLead({ fieldValues: {} });
    const process = repo.seedProcess(lead.id, journeyA, statusEarly);
    const response = await editLead({
      auth,
      leadRepository: repo,
      permissionRepository: permissionRepository({ editableFields: [fieldVisible] }),
      processInstanceId: process.id,
      journeyId: journeyA,
      leadId: lead.id,
      assignmentTypes: [assignmentType],
      statusId: statusRequired,
      now,
    });
    expect(response).toEqual({
      status: 400,
      body: { error: 'validation_error', details: { fieldId: fieldVisible } },
    });
    expect(repo.activities).toHaveLength(0);
  });

  it('writes field_edit and status_change activity rows when editing succeeds', async () => {
    const repo = new MemoryLeadRepository();
    repo.fieldSettings = [requiredFromField(statusRequired)];
    const lead = repo.seedLead({ fieldValues: { [fieldVisible]: 'ready' } });
    const process = repo.seedProcess(lead.id, journeyA, statusEarly);
    const response = await editLead({
      auth,
      leadRepository: repo,
      permissionRepository: permissionRepository({ editableFields: [fieldVisible] }),
      processInstanceId: process.id,
      journeyId: journeyA,
      leadId: lead.id,
      assignmentTypes: [assignmentType],
      name: 'Updated Synthetic Seller',
      statusId: statusRequired,
      now,
    });
    expect(response.status).toBe(200);
    expect(repo.activities.map((activity) => activity.actionType)).toEqual([
      'field_edit',
      'status_change',
    ]);
  });

  it('applies field visibility to paginated Seller List rows', async () => {
    const repo = new MemoryLeadRepository();
    repo.seedLead({ fieldValues: { [fieldVisible]: 'visible', [fieldHidden]: 'hidden' } });
    const response = await listSellers({
      auth,
      sellerRepository: repo,
      permissionRepository: permissionRepository({ visibleFields: [fieldVisible] }),
      list: {
        journeyId: journeyA,
        requestedFieldIds: [fieldVisible, fieldHidden],
        assignmentTypes: [assignmentType],
        page: 1,
        pageSize: 10,
      },
      now,
    });
    expect(repo.lastRecordPredicate).toBeDefined();
    expect(response).toEqual({
      status: 200,
      body: {
        total: 1,
        rows: [
          {
            id: 'lead-1',
            name: 'Synthetic Seller',
            phone: null,
            email: null,
            fieldValues: { [fieldVisible]: 'visible' },
            processInstances: [],
          },
        ],
      },
    });
  });

  it('includes journey, status, and owner summary per row so the Seller List UI never needs a second request', async () => {
    const repo = new MemoryLeadRepository();
    const lead = repo.seedLead({ fieldValues: { [fieldVisible]: 'visible' } });
    const process = repo.seedProcess(lead.id, journeyA, statusEarly);
    const response = await listSellers({
      auth,
      sellerRepository: repo,
      permissionRepository: permissionRepository({ visibleFields: [fieldVisible] }),
      list: {
        journeyId: journeyA,
        requestedFieldIds: [fieldVisible],
        assignmentTypes: [assignmentType],
        page: 1,
        pageSize: 10,
      },
      now,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      rows: [
        {
          id: lead.id,
          processInstances: [
            {
              processInstanceId: process.id,
              journeyId: journeyA,
              journeyName: 'Synthetic Journey',
              statusId: statusEarly,
              statusName: 'Synthetic Status',
              statusOutcomeType: 'open',
              statusBehaviorType: 'default',
              ownerName: 'Synthetic Owner',
            },
          ],
        },
      ],
    });
  });

  it('returns Seller 360 with all authorized active process instances and visible fields', async () => {
    const repo = new MemoryLeadRepository();
    const lead = repo.seedLead({
      fieldValues: { [fieldVisible]: 'visible', [fieldHidden]: 'hidden' },
    });
    repo.seedProcess(lead.id, journeyA, statusEarly);
    repo.seedProcess(lead.id, journeyB, statusEarly);
    const response = await getSeller360({
      auth,
      sellerRepository: repo,
      permissionRepository: permissionRepository({
        visibleFields: [fieldVisible],
        journeys: [journeyA, journeyB],
      }),
      leadId: lead.id,
      requestedFieldIds: [fieldVisible, fieldHidden],
      assignmentTypes: [assignmentType],
      now,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: lead.id,
      fieldValues: { [fieldVisible]: 'visible' },
      processInstances: [{ journeyId: journeyA }, { journeyId: journeyB }],
    });
  });

  it('unions Seller 360 field visibility across authorized journey contexts', async () => {
    const repo = new MemoryLeadRepository();
    const lead = repo.seedLead({
      fieldValues: {
        [fieldVisible]: 'visible from journey a',
        [fieldHidden]: 'visible from journey b',
      },
    });
    repo.seedProcess(lead.id, journeyA, statusEarly);
    repo.seedProcess(lead.id, journeyB, statusEarly);
    const response = await getSeller360({
      auth,
      sellerRepository: repo,
      permissionRepository: permissionRepository({
        journeys: [journeyA, journeyB],
        visibleFieldsByJourney: new Map([
          [journeyA, [fieldVisible]],
          [journeyB, [fieldHidden]],
        ]),
      }),
      leadId: lead.id,
      requestedFieldIds: [fieldVisible, fieldHidden],
      assignmentTypes: [assignmentType],
      now,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      fieldValues: {
        [fieldVisible]: 'visible from journey a',
        [fieldHidden]: 'visible from journey b',
      },
    });
  });

  it('supports approved all-journeys Seller List requests without requiring journeyId', async () => {
    const repo = new MemoryLeadRepository();
    repo.seedLead({ fieldValues: { [fieldVisible]: 'visible' } });
    const response = await listSellers({
      auth,
      sellerRepository: repo,
      permissionRepository: permissionRepository({
        visibleFields: [fieldVisible],
        journeys: [journeyA, journeyB],
      }),
      list: {
        requestedFieldIds: [fieldVisible],
        assignmentTypes: [assignmentType],
        page: 1,
        pageSize: 10,
      },
      now,
    });
    expect(response.status).toBe(200);
    expect(repo.lastRecordPredicate).toMatchObject({ journeyIds: [journeyA, journeyB] });
  });

  it('preserves cross-organization isolation', async () => {
    const repo = new MemoryLeadRepository();
    const lead = repo.seedLead({
      organizationId: orgB,
      fieldValues: { [fieldVisible]: 'other org' },
    });
    const response = await getSeller360({
      auth,
      sellerRepository: repo,
      permissionRepository: permissionRepository({ visibleFields: [fieldVisible] }),
      leadId: lead.id,
      requestedFieldIds: [fieldVisible],
      assignmentTypes: [assignmentType],
      now,
    });
    expect(response.status).toBe(404);
  });
});

class MemoryLeadRepository implements LeadRepository {
  leads: LeadCoreRecord[] = [];
  processes: LeadProcessRecord[] = [];
  assignments: LeadAssignmentRecord[] = [];
  activities: LeadActivityInput[] = [];
  lastRecordPredicate: unknown;
  fieldSettings: LeadFieldSetting[] = [optionalField(fieldVisible)];

  async transaction<T>(work: (repository: LeadRepository) => Promise<T>): Promise<T> {
    return work(this);
  }
  async findJourney(organizationId: string, journeyId: string) {
    return organizationId === orgA && [journeyA, journeyB].includes(journeyId)
      ? { id: journeyId, active: true }
      : null;
  }
  async findStatus(organizationId: string, journeyId: string, statusId: string) {
    return organizationId === orgA &&
      [journeyA, journeyB].includes(journeyId) &&
      [statusEarly, statusRequired].includes(statusId)
      ? { id: statusId, active: true }
      : null;
  }
  async findDefaultStatus() {
    return { id: statusEarly, active: true };
  }
  async listFieldSettings() {
    return this.fieldSettings;
  }
  async findLead(organizationId: string, leadId: string) {
    return (
      this.leads.find((lead) => lead.organizationId === organizationId && lead.id === leadId) ??
      null
    );
  }
  async findProcessInstance(organizationId: string, processInstanceId: string) {
    return (
      this.processes.find(
        (process) => process.organizationId === organizationId && process.id === processInstanceId,
      ) ?? null
    );
  }
  async findActiveProcessInstanceByLeadJourney(
    organizationId: string,
    leadId: string,
    journeyId: string,
  ) {
    return (
      this.processes.find(
        (process) =>
          process.organizationId === organizationId &&
          process.leadId === leadId &&
          process.journeyId === journeyId &&
          process.active,
      ) ?? null
    );
  }
  async createLead(input: Omit<LeadCoreRecord, 'id'>) {
    const lead = { ...input, id: `lead-${this.leads.length + 1}` };
    this.leads.push(lead);
    return lead;
  }
  async updateLead(organizationId: string, leadId: string, input: Partial<LeadCoreRecord>) {
    const lead = await this.findLead(organizationId, leadId);
    if (lead === null) return null;
    Object.assign(lead, input);
    return lead;
  }
  async createProcessInstance(input: Omit<LeadProcessRecord, 'id' | 'active'>) {
    const process = { ...input, id: `process-${this.processes.length + 1}`, active: true };
    this.processes.push(process);
    return process;
  }
  async updateProcessInstanceStatus(
    organizationId: string,
    processInstanceId: string,
    statusId: string,
  ) {
    const process = await this.findProcessInstance(organizationId, processInstanceId);
    if (process === null) return null;
    process.currentStatusId = statusId;
    return process;
  }
  async createAssignment(input: Omit<LeadAssignmentRecord, 'id' | 'isCurrent'>) {
    const row = { ...input, id: `assignment-${this.assignments.length + 1}`, isCurrent: true };
    this.assignments.push(row);
    return row;
  }
  async userExists(organizationId: string, userId: string) {
    return organizationId === orgA && userId === actorId;
  }
  async writeActivity(input: LeadActivityInput) {
    this.activities.push(input);
  }
  async findSeller360(organizationId: string, leadId: string): Promise<Seller360Record | null> {
    const lead = await this.findLead(organizationId, leadId);
    if (lead === null) return null;
    return {
      ...lead,
      processInstances: this.processes
        .filter(
          (process) => process.leadId === lead.id && process.organizationId === organizationId,
        )
        .map((process) => ({
          ...process,
          journey: { id: process.journeyId, key: 'synthetic_journey', name: 'Synthetic Journey' },
          currentStatus: {
            id: process.currentStatusId,
            key: 'synthetic_status',
            name: 'Synthetic Status',
          },
          assignments: this.assignments.filter(
            (assignment) => assignment.processInstanceId === process.id,
          ),
        })),
    };
  }
  async listSellers(input: {
    organizationId: string;
    recordPredicate: unknown;
  }): Promise<{ rows: SellerListRecord[]; total: number }> {
    this.lastRecordPredicate = input.recordPredicate;
    const rows = this.leads
      .filter((lead) => lead.organizationId === input.organizationId)
      .map((lead) => ({
        ...lead,
        processInstances: this.processes
          .filter((process) => process.leadId === lead.id)
          .map((process) => {
            const owner = this.assignments.find(
              (assignment) => assignment.processInstanceId === process.id,
            );
            return {
              processInstanceId: process.id,
              journeyId: process.journeyId,
              journeyName: 'Synthetic Journey',
              statusId: process.currentStatusId,
              statusName: 'Synthetic Status',
              statusOutcomeType: 'open',
              statusBehaviorType: 'default',
              ownerName: owner === undefined ? null : 'Synthetic Owner',
            };
          }),
      }));
    return { rows, total: rows.length };
  }
  seedLead(input: { organizationId?: string; fieldValues: Record<string, unknown> }) {
    const lead = {
      id: `lead-${this.leads.length + 1}`,
      organizationId: input.organizationId ?? orgA,
      name: 'Synthetic Seller',
      phone: null,
      email: null,
      fieldValues: input.fieldValues,
    };
    this.leads.push(lead);
    return lead;
  }
  seedProcess(leadId: string, journeyId: string, currentStatusId: string) {
    const process = {
      id: `process-${this.processes.length + 1}`,
      organizationId: orgA,
      leadId,
      journeyId,
      currentStatusId,
      isPrimary: false,
      active: true,
    };
    this.processes.push(process);
    this.assignments.push({
      id: `assignment-${this.assignments.length + 1}`,
      organizationId: orgA,
      processInstanceId: process.id,
      assignmentType,
      userId: actorId,
      isCurrent: true,
    });
    return process;
  }
}

function permissionRepository(
  input: {
    visibleFields?: string[];
    editableFields?: string[];
    journeys?: string[];
    assignmentTypes?: string[];
    visibleFieldsByJourney?: Map<string, string[]>;
  } = {},
): PermissionRepository {
  return {
    async getUser() {
      return auth.user;
    },
    async getRole() {
      return { id: roleId, organizationId: orgA, active: true, version: 1 };
    },
    async getRolePermission(_input) {
      return { module: _input.module, action: _input.action, scope: 'ORGANIZATION' };
    },
    async hasJourneyAccess(request) {
      return (input.journeys ?? [journeyA]).includes(request.journeyId);
    },
    async listAccessibleJourneyIds() {
      return input.journeys ?? [journeyA];
    },
    async getFieldVisibility(request) {
      const visibleFields =
        input.visibleFieldsByJourney?.get(request.journeyId ?? '') ?? input.visibleFields ?? [];
      return request.fieldIds
        .filter((fieldId) => [...visibleFields, ...(input.editableFields ?? [])].includes(fieldId))
        .map((fieldId) => ({
          fieldId,
          accessLevel: input.editableFields?.includes(fieldId) ? 'EDIT' : 'VIEW',
        }));
    },
    async getLeadScope() {
      return null;
    },
    async listActiveUserIds() {
      return [actorId];
    },
    async listDepartmentUserIds() {
      return [actorId];
    },
    async listReports() {
      return [];
    },
    async listCurrentAssignments() {
      return [journeyA, journeyB].map((journeyId, index) => ({
        leadId: 'lead-1',
        processInstanceId: `process-${index + 1}`,
        assignmentType,
        userId: actorId,
        organizationId: orgA,
        isCurrent: true,
        journeyId,
      }));
    },
    async getActiveDirectGrant() {
      return null;
    },
  };
}

function optionalField(fieldId: string): LeadFieldSetting {
  return {
    fieldId,
    journeyId: journeyA,
    requirement: 'optional',
    requiredFromStatusId: null,
    active: true,
    field: { id: fieldId, fieldType: 'text', validationRule: null, active: true },
  };
}
function requiredFromField(statusId: string): LeadFieldSetting {
  return {
    ...optionalField(fieldVisible),
    requirement: 'required',
    requiredFromStatusId: statusId,
  };
}
