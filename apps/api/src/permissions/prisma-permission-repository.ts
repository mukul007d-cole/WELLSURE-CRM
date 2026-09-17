import type {
  AssignmentSnapshot,
  DirectGrantSnapshot,
  FieldAccessLevel,
  FieldVisibilitySnapshot,
  LeadScopeSnapshot,
  PermissionRepository,
  RolePermissionSnapshot,
  RoleSnapshot,
  UserSnapshot,
} from '@falcon/permission-engine';

type DataScope = RolePermissionSnapshot['scope'];

interface PrismaPermissionClient {
  user: {
    findUnique(args: unknown): Promise<UserRow | null>;
    findMany(args: unknown): Promise<UserRow[]>;
  };
  role: { findUnique(args: unknown): Promise<RoleRow | null> };
  rolePermission: {
    findUnique(args: unknown): Promise<RolePermissionRow | null>;
    findMany(args: unknown): Promise<RolePermissionRow[]>;
  };
  roleJourneyAccess: {
    findUnique(args: unknown): Promise<JourneyAccessRow | null>;
    findMany(args: unknown): Promise<JourneyAccessRow[]>;
  };
  statusRoutingRule: { findFirst(args: unknown): Promise<StatusRoutingRuleRow | null> };
  fieldVisibility: { findMany(args: unknown): Promise<FieldVisibilityRow[]> };
  resourceVisibility: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  lead: { findUnique(args: unknown): Promise<LeadScopeRow | null> };
  assignment: { findMany(args: unknown): Promise<AssignmentRow[]> };
  userAccessGrant: { findFirst(args: unknown): Promise<DirectGrantRow | null> };
}

interface UserRow {
  id: string;
  organizationId: string;
  roleId: string;
  active: boolean;
  departmentId: string | null;
  managerId: string | null;
}
interface RoleRow {
  id: string;
  organizationId: string;
  active: boolean;
  version: number;
}
interface RolePermissionRow {
  module: string;
  action: string;
  scope: DataScope;
}
interface JourneyAccessRow {
  journeyId: string;
}
interface StatusRoutingRuleRow {
  id: string;
}
interface FieldVisibilityRow {
  fieldId: string;
  accessLevel: FieldAccessLevel;
}
interface AssignmentRow {
  processInstance: { leadId: string; journeyId: string };
  processInstanceId: string;
  assignmentType: string;
  userId: string;
  organizationId: string;
  isCurrent: boolean;
}
interface DirectGrantRow {
  id: string;
  leadId: string;
  userId: string;
  organizationId: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  actions: string[];
}
interface LeadScopeRow {
  id: string;
  organizationId: string;
  processInstances: Array<{ journeyId: string; assignments: Array<{ userId: string }> }>;
}

export class PrismaPermissionRepository implements PermissionRepository {
  constructor(private readonly prisma: PrismaPermissionClient) {}

  async getUser(userId: string, organizationId: string): Promise<UserSnapshot | null> {
    const row = await this.prisma.user.findUnique({
      where: { organizationId_id: { organizationId, id: userId } },
    });
    return row === null ? null : user(row);
  }

  async getRole(roleId: string, organizationId: string): Promise<RoleSnapshot | null> {
    const row = await this.prisma.role.findUnique({
      where: { organizationId_id: { organizationId, id: roleId } },
    });
    return row === null ? null : row;
  }

  async getRolePermission(input: {
    roleId: string;
    organizationId: string;
    module: string;
    action: string;
  }): Promise<RolePermissionSnapshot | null> {
    const row = await this.prisma.rolePermission.findUnique({
      where: { organizationId_roleId_module_action: input },
    });
    return row === null ? null : { module: row.module, action: row.action, scope: row.scope };
  }

  async listRolePermissions(input: { roleId: string; organizationId: string }) {
    return this.prisma.rolePermission.findMany({
      where: input,
      select: { module: true, action: true, scope: true },
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
  }

  async hasJourneyAccess(input: {
    roleId: string;
    organizationId: string;
    journeyId: string;
  }): Promise<boolean> {
    const row = await this.prisma.roleJourneyAccess.findUnique({
      where: { organizationId_roleId_journeyId: input },
    });
    return row !== null;
  }

  /**
   * Phase 20's one consequential default, encoded in exactly one place: a
   * Status with no active routing rule imposes no restriction; one with an
   * active rule restricts visibility to the lead's current assignee and
   * that assignee's reporting-hierarchy ancestors, computed in
   * `decision.ts` from `listCurrentAssignments`/`expandScopeUserIds`, not
   * here. Every caller of this method — the single-record decision here and
   * the SQL/Prisma list predicates in
   * `apps/api/src/leads/{filter-sql,prisma-lead-repository}.ts` — must agree
   * with this same rule or the surfaces would disagree about one lead.
   */
  async hasActiveRoutingRule(input: {
    organizationId: string;
    statusId: string;
  }): Promise<boolean> {
    const rule = await this.prisma.statusRoutingRule.findFirst({
      where: { organizationId: input.organizationId, statusId: input.statusId, active: true },
      select: { id: true },
    });
    return rule !== null;
  }

  /** ADR-0021 — see the interface doc comment. Reuses `getRolePermission`'s real lookup. */
  async hasStatusVisibilityBypass(input: {
    roleId: string;
    organizationId: string;
  }): Promise<boolean> {
    const permission = await this.getRolePermission({
      roleId: input.roleId,
      organizationId: input.organizationId,
      module: 'leads',
      action: 'bypass_status_visibility',
    });
    return permission !== null;
  }

  async listAccessibleJourneyIds(input: {
    roleId: string;
    organizationId: string;
  }): Promise<readonly string[]> {
    const rows = await this.prisma.roleJourneyAccess.findMany({
      where: { organizationId: input.organizationId, roleId: input.roleId },
      select: { journeyId: true },
    });
    return rows.map((row) => row.journeyId);
  }

  async getFieldVisibility(input: {
    roleId: string;
    organizationId: string;
    fieldIds: readonly string[];
  }): Promise<readonly FieldVisibilitySnapshot[]> {
    return this.prisma.fieldVisibility.findMany({
      where: {
        organizationId: input.organizationId,
        roleId: input.roleId,
        fieldId: { in: [...input.fieldIds] },
      },
      select: { fieldId: true, accessLevel: true },
    });
  }

  async listFieldVisibility(input: { roleId: string; organizationId: string }) {
    return this.prisma.fieldVisibility.findMany({
      where: input,
      select: { fieldId: true, accessLevel: true },
      orderBy: { fieldId: 'asc' },
    });
  }

  /**
   * Whether this Role may access one specific Resource — the whole-entity
   * analogue of `hasJourneyAccess`, not a per-value strip like
   * `getFieldVisibility`. A pure membership check: absence of a row means
   * hidden (Phase 22's decision, matching `field_visibility`'s default, not
   * the superseded `status_visibility` one — see
   * docs/planning/phase-22-tools-resource-library.md).
   */
  async hasResourceVisibility(input: {
    roleId: string;
    organizationId: string;
    resourceId: string;
  }): Promise<boolean> {
    const row = await this.prisma.resourceVisibility.findFirst({
      where: {
        organizationId: input.organizationId,
        roleId: input.roleId,
        resourceId: input.resourceId,
      },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Whether this Role has *any* accessible Resource at all — a cheap EXISTS
   * used only to gate the Tools nav entry (`GET /auth/capabilities`'s
   * `hasAccessibleTools`), joined against active Resources so a grant on a
   * since-deactivated Resource doesn't keep a dead nav entry alive.
   */
  async hasAnyResourceVisibility(input: {
    roleId: string;
    organizationId: string;
  }): Promise<boolean> {
    const row = await this.prisma.resourceVisibility.findFirst({
      where: {
        organizationId: input.organizationId,
        roleId: input.roleId,
        resource: { active: true },
      },
      select: { id: true },
    });
    return row !== null;
  }

  async getLeadScope(input: {
    leadId: string;
    organizationId: string;
  }): Promise<LeadScopeSnapshot | null> {
    const row = await this.prisma.lead.findUnique({
      where: { organizationId_id: { organizationId: input.organizationId, id: input.leadId } },
      include: {
        processInstances: {
          where: { active: true },
          include: { assignments: { where: { isCurrent: true }, select: { userId: true } } },
        },
      },
    });
    const process = row?.processInstances[0];
    if (row === null || row === undefined || process === undefined) {
      return null;
    }
    return {
      leadId: row.id,
      organizationId: row.organizationId,
      journeyId: process.journeyId,
      assignedUserIds: process.assignments.map((assignment) => assignment.userId),
    };
  }

  async listActiveUserIds(input: { organizationId: string }): Promise<readonly string[]> {
    const rows = await this.prisma.user.findMany({
      where: { organizationId: input.organizationId, active: true },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async listDepartmentUserIds(input: {
    organizationId: string;
    departmentId: string;
  }): Promise<readonly string[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        organizationId: input.organizationId,
        departmentId: input.departmentId,
        active: true,
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async listReports(input: {
    organizationId: string;
    managerId: string;
  }): Promise<readonly UserSnapshot[]> {
    const rows = await this.prisma.user.findMany({
      where: { organizationId: input.organizationId, managerId: input.managerId },
      select: {
        id: true,
        organizationId: true,
        roleId: true,
        active: true,
        departmentId: true,
        managerId: true,
      },
    });
    return rows.map(user);
  }

  async listCurrentAssignments(input: {
    organizationId: string;
    assignmentTypes: readonly string[];
    journeyIds?: readonly string[];
  }): Promise<readonly AssignmentSnapshot[]> {
    const rows = await this.prisma.assignment.findMany({
      where: {
        organizationId: input.organizationId,
        isCurrent: true,
        // Empty means the caller named no types, not "match none" — the same
        // convention the Seller List's own assignment clause uses (see
        // `apps/api/src/leads/prisma-lead-repository.ts`'s `processWhere`).
        // An unconditional `IN ()` here fed `assignmentScopeAllowsLead` zero
        // rows for every caller that omitted `assignmentTypes`, denying a
        // single-record decision even for a user genuinely assigned to it.
        ...(input.assignmentTypes.length === 0
          ? {}
          : { assignmentType: { in: [...input.assignmentTypes] } }),
        ...(input.journeyIds === undefined
          ? {}
          : { processInstance: { journeyId: { in: [...input.journeyIds] } } }),
      },
      include: { processInstance: { select: { leadId: true, journeyId: true } } },
    });
    return rows.map((row) => ({
      leadId: row.processInstance.leadId,
      processInstanceId: row.processInstanceId,
      assignmentType: row.assignmentType,
      userId: row.userId,
      organizationId: row.organizationId,
      isCurrent: row.isCurrent,
      journeyId: row.processInstance.journeyId,
    }));
  }

  async getActiveDirectGrant(input: {
    organizationId: string;
    userId: string;
    leadId: string;
    now: Date;
    action: string;
  }): Promise<DirectGrantSnapshot | null> {
    const row = await this.prisma.userAccessGrant.findFirst({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        leadId: input.leadId,
        revokedAt: null,
        actions: { has: input.action },
        OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    return row;
  }
}

function user(row: UserRow): UserSnapshot {
  return {
    id: row.id,
    organizationId: row.organizationId,
    roleId: row.roleId,
    active: row.active,
    departmentId: row.departmentId,
    managerId: row.managerId,
  };
}
