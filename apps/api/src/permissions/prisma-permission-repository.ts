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
  rolePermission: { findUnique(args: unknown): Promise<RolePermissionRow | null> };
  roleJourneyAccess: {
    findUnique(args: unknown): Promise<JourneyAccessRow | null>;
    findMany(args: unknown): Promise<JourneyAccessRow[]>;
  };
  fieldVisibility: { findMany(args: unknown): Promise<FieldVisibilityRow[]> };
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
        assignmentType: { in: [...input.assignmentTypes] },
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
  }): Promise<DirectGrantSnapshot | null> {
    const row = await this.prisma.userAccessGrant.findFirst({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        leadId: input.leadId,
        revokedAt: null,
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
