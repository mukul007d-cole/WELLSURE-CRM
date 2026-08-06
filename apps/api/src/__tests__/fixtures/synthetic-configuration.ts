/* eslint-disable @typescript-eslint/require-await */
import type { PermissionRepository } from '@falcon/permission-engine';
import type { ConfigurationAuditInput, LeadActivityInput } from '../../configuration/audit.js';
import type {
  ConfigRow,
  ConfigurationRepository,
  ProcessInstanceStatusMove,
} from '../../configuration/service.js';

export const orgA = '11111111-1111-1111-1111-111111111111';
export const orgB = '22222222-2222-2222-2222-222222222222';
export const actorId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
export const roleId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
export const journeyId = '33333333-3333-3333-3333-333333333333';
export const replacementStatusId = '44444444-4444-4444-4444-444444444444';
export const statusId = '55555555-5555-5555-5555-555555555555';

export class MemoryConfigurationRepository implements ConfigurationRepository {
  rows = {
    journeys: new Map<string, ConfigRow>([
      [
        journeyId,
        {
          id: journeyId,
          organizationId: orgA,
          key: 'test_journey_a',
          name: 'Test Journey A',
          active: true,
        },
      ],
    ]),
    statuses: new Map<string, ConfigRow>([
      [
        statusId,
        {
          id: statusId,
          organizationId: orgA,
          journeyId,
          key: 'test_status_a',
          name: 'Test Status A',
          active: true,
        },
      ],
      [
        replacementStatusId,
        {
          id: replacementStatusId,
          organizationId: orgA,
          journeyId,
          key: 'test_status_b',
          name: 'Test Status B',
          active: true,
        },
      ],
    ]),
    services: new Map<string, ConfigRow>(),
    fields: new Map<string, ConfigRow>(),
    journeyServices: new Map<string, ConfigRow>(),
    fieldSettings: new Map<string, ConfigRow>(),
    fieldVisibility: new Map<string, ConfigRow>(),
  };
  processInstances: ProcessInstanceStatusMove[] = [];
  leadServices: Array<{ serviceId: string; active: boolean }> = [];
  systemAudits: ConfigurationAuditInput[] = [];
  activities: LeadActivityInput[] = [];
  async transaction<T>(work: (repository: ConfigurationRepository) => Promise<T>): Promise<T> {
    return work(this);
  }
  async listJourneys(
    org: string,
    active: boolean | undefined,
    page: number,
    pageSize: number,
    accessible: readonly string[],
  ) {
    const all = [...this.rows.journeys.values()].filter(
      (x) =>
        x.organizationId === org &&
        accessible.includes(x.id) &&
        (active === undefined || x.active === active),
    );
    return { total: all.length, items: all.slice((page - 1) * pageSize, page * pageSize) };
  }
  async getJourneyDetail(org: string, id: string, active?: boolean) {
    const row = find(this.rows.journeys, org, id);
    return row && (active === undefined || row.active === active) ? row : null;
  }
  /** Overridable per-test; the in-memory rows carry no assignments. */
  journeyAssignmentTypes = new Map<string, string[]>();
  async listJourneyAssignmentTypes(_org: string, journeyId: string) {
    return this.journeyAssignmentTypes.get(journeyId) ?? [];
  }
  /** Roles that would be granted access; recorded so tests can assert on it. */
  configRoleIds: string[] = [];
  grantedJourneyAccess: Array<{ journeyId: string; roleIds: string[] }> = [];
  async grantJourneyAccessToConfigRoles(_org: string, journeyId: string) {
    this.grantedJourneyAccess.push({ journeyId, roleIds: [...this.configRoleIds] });
    return [...this.configRoleIds];
  }
  async listServices(org: string, active: boolean | undefined, page: number, pageSize: number) {
    const all = [...this.rows.services.values()].filter(
      (x) => x.organizationId === org && (active === undefined || x.active === active),
    );
    return { total: all.length, items: all.slice((page - 1) * pageSize, page * pageSize) };
  }
  async getServiceDetail(org: string, id: string, active?: boolean) {
    const row = find(this.rows.services, org, id);
    return row && (active === undefined || row.active === active) ? row : null;
  }
  async listFields(
    org: string,
    active: boolean | undefined,
    page: number,
    pageSize: number,
    _accessible: readonly string[],
  ) {
    void _accessible;
    const all = [...this.rows.fields.values()].filter(
      (x) => x.organizationId === org && (active === undefined || x.active === active),
    );
    return { total: all.length, items: all.slice((page - 1) * pageSize, page * pageSize) };
  }
  async getFieldDetail(
    org: string,
    id: string,
    active: boolean | undefined,
    _accessible: readonly string[],
  ) {
    void _accessible;
    const row = find(this.rows.fields, org, id);
    return row && (active === undefined || row.active === active) ? row : null;
  }
  async listJourneyFieldSettings(org: string, journey: string) {
    return [...this.rows.fieldSettings.values()].filter(
      (row) => row.organizationId === org && row.journeyId === journey && row.active !== false,
    );
  }
  async writeSystemAudit(input: ConfigurationAuditInput) {
    this.systemAudits.push(input);
  }
  async writeActivity(input: LeadActivityInput) {
    this.activities.push(input);
  }
  async createJourney(input: Record<string, unknown>) {
    return put(this.rows.journeys, input);
  }
  async updateJourney(org: string, id: string, input: Record<string, unknown>) {
    return update(this.rows.journeys, org, id, input);
  }
  async findJourney(org: string, id: string) {
    return find(this.rows.journeys, org, id);
  }
  async countActiveProcessInstancesForJourney(org: string, id: string) {
    return this.processInstances.filter((p) => p.organizationId === org && p.journeyId === id)
      .length;
  }
  async createStatus(input: Record<string, unknown>) {
    return put(this.rows.statuses, input);
  }
  async updateStatus(org: string, id: string, input: Record<string, unknown>) {
    return update(this.rows.statuses, org, id, input);
  }
  async findStatus(org: string, id: string) {
    return find(this.rows.statuses, org, id);
  }
  async listActiveProcessInstancesForStatus(org: string, id: string) {
    return this.processInstances.filter(
      (p) => p.organizationId === org && p.currentStatusId === id,
    );
  }
  async reassignProcessInstances(input: {
    organizationId: string;
    fromStatusId: string;
    toStatusId: string;
  }) {
    let count = 0;
    for (const p of this.processInstances)
      if (p.organizationId === input.organizationId && p.currentStatusId === input.fromStatusId) {
        p.currentStatusId = input.toStatusId;
        count++;
      }
    return count;
  }
  async createService(input: Record<string, unknown>) {
    return put(this.rows.services, input);
  }
  async updateService(org: string, id: string, input: Record<string, unknown>) {
    return update(this.rows.services, org, id, input);
  }
  async findService(org: string, id: string) {
    return find(this.rows.services, org, id);
  }
  async countActiveLeadServicesForService(_org: string, id: string) {
    return this.leadServices.filter((s) => s.serviceId === id && s.active).length;
  }
  async createField(input: Record<string, unknown>) {
    return put(this.rows.fields, input);
  }
  async updateField(org: string, id: string, input: Record<string, unknown>) {
    return update(this.rows.fields, org, id, input);
  }
  async findField(org: string, id: string) {
    return find(this.rows.fields, org, id);
  }
  async countFieldSettings(org: string, id: string) {
    return [...this.rows.fieldSettings.values()].filter(
      (r) => r.organizationId === org && r.fieldId === id,
    ).length;
  }
  async countFieldVisibility(org: string, id: string) {
    return [...this.rows.fieldVisibility.values()].filter(
      (r) => r.organizationId === org && r.fieldId === id,
    ).length;
  }
  async upsertJourneyService(input: {
    organizationId: string;
    journeyId: string;
    serviceId: string;
  }) {
    return put(this.rows.journeyServices, input);
  }
  async deleteJourneyService(org: string, journey: string, service: string) {
    return remove(
      this.rows.journeyServices,
      org,
      (r) => r.journeyId === journey && r.serviceId === service,
    );
  }
  async upsertFieldJourneySetting(input: Record<string, unknown>) {
    return put(this.rows.fieldSettings, input);
  }
  async deleteFieldJourneySetting(org: string, field: string, journey: string) {
    return remove(
      this.rows.fieldSettings,
      org,
      (r) => r.fieldId === field && r.journeyId === journey,
    );
  }
  async upsertFieldVisibility(input: {
    organizationId: string;
    fieldId: string;
    roleId: string;
    accessLevel: string;
  }) {
    return put(this.rows.fieldVisibility, input);
  }
  async deleteFieldVisibility(org: string, field: string, role: string) {
    return remove(this.rows.fieldVisibility, org, (r) => r.fieldId === field && r.roleId === role);
  }
}

function put(map: Map<string, ConfigRow>, input: Record<string, unknown>): ConfigRow {
  const id = (input.id as string | undefined) ?? crypto.randomUUID();
  const row = { id, active: true, ...input } as ConfigRow;
  map.set(id, row);
  return row;
}
function find(map: Map<string, ConfigRow>, org: string, id: string) {
  const row = map.get(id);
  return row?.organizationId === org ? row : null;
}
function update(
  map: Map<string, ConfigRow>,
  org: string,
  id: string,
  input: Record<string, unknown>,
) {
  const row = find(map, org, id);
  if (row === null) return null;
  Object.assign(row, input);
  return row;
}
function remove(map: Map<string, ConfigRow>, org: string, predicate: (row: ConfigRow) => boolean) {
  for (const [id, row] of map)
    if (row.organizationId === org && predicate(row)) {
      map.delete(id);
      return row;
    }
  return null;
}

export function auth() {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    session: {
      id: 'session-a',
      organizationId: orgA,
      userId: actorId,
      tokenHash: 'hash',
      createdAt: now,
      expiresAt: new Date('2026-01-02T00:00:00.000Z'),
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
}

export function permissionRepository(allowed = true): PermissionRepository {
  return {
    async getUser() {
      return {
        id: actorId,
        organizationId: orgA,
        roleId,
        active: true,
        departmentId: null,
        managerId: null,
      };
    },
    async getRole() {
      return { id: roleId, organizationId: orgA, active: true, version: 1 };
    },
    async getRolePermission(_input: {
      roleId: string;
      organizationId: string;
      module: string;
      action: string;
    }) {
      return allowed
        ? { module: _input.module, action: _input.action, scope: 'ORGANIZATION' as const }
        : null;
    },
    async hasJourneyAccess(input: { roleId: string; organizationId: string; journeyId: string }) {
      return input.journeyId === journeyId;
    },
    async listAccessibleJourneyIds() {
      return [journeyId];
    },
    async getFieldVisibility() {
      return [];
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
      return [];
    },
    async getActiveDirectGrant() {
      return null;
    },
  };
}
