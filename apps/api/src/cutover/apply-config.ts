import { Prisma, type FalconPrismaClient } from '@falcon/database';

import type { CutoverConfig, FieldConfig } from './config.js';
import { countConfig, type CutoverReport } from './report.js';
import type { SourceUser } from './sources.js';

type Tx = FalconPrismaClient;
type Json = Record<string, unknown>;

/**
 * Everything the lead migration needs to resolve a key or a name to an id,
 * built while the configuration is applied.
 */
export interface Resolved {
  roleIdByKey: Map<string, string>;
  fieldIdByKey: Map<string, string>;
  journeyIdByKey: Map<string, string>;
  /** `${journeyKey}:${spelling lowercased}` → status id, for every name and alias. */
  statusIdBySpelling: Map<string, string>;
  statusById: Map<string, { journeyKey: string; key: string; outcome: string }>;
  /** Lowercased, space-collapsed name → user ids (several when names collide). */
  userIdsByName: Map<string, Array<{ id: string; active: boolean }>>;
  userIdByEmail: Map<string, string>;
  /** Inactive placeholder accounts for former owners (D3): never journey members. */
  placeholderUserIds: Set<string>;
  /** Roles outside the config that administer permissions (the bootstrap admin). */
  adminRoleIds: string[];
}

export function nameLookupKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Applies the configuration idempotently, matching every entity by key. A
 * re-run updates names and rules to the file and creates what is missing; it
 * never deletes anything and never touches entities the file does not name.
 * Every create and update writes a `system_audit_logs` row attributed to the
 * operator running the cutover.
 */
export async function applyConfiguration(input: {
  tx: Tx;
  organizationId: string;
  actorUserId: string;
  config: CutoverConfig;
  users: readonly SourceUser[];
  report: CutoverReport;
}): Promise<Resolved> {
  const { tx, organizationId, actorUserId, config, report } = input;
  const audit = (
    entityType: string,
    entityId: string,
    action: string,
    oldValue: unknown,
    newValue: unknown,
  ) =>
    tx.systemAuditLog.create({
      data: {
        organizationId,
        actorUserId,
        entityType,
        entityId,
        action: `cutover.${action}`,
        oldValue: (oldValue ?? undefined) as never,
        newValue: (newValue ?? undefined) as never,
      },
    });
  /** Create-or-update by key; audits and counts either way, skips a no-op. */
  async function upsertByKey<T extends { id: string }>(
    entity: string,
    existing: (T & Json) | null,
    desired: Json,
    create: () => Promise<T>,
    update: (id: string) => Promise<T>,
  ): Promise<T> {
    if (existing === null) {
      const row = await create();
      await audit(entity, row.id, 'create', null, desired);
      countConfig(report, 'created', entity);
      return row;
    }
    const changed = Object.entries(desired).some(
      ([key, value]) => JSON.stringify(existing[key]) !== JSON.stringify(value),
    );
    if (!changed) return existing;
    const before = Object.fromEntries(Object.keys(desired).map((key) => [key, existing[key]]));
    const row = await update(existing.id);
    await audit(entity, row.id, 'update', before, desired);
    countConfig(report, 'updated', entity);
    return row;
  }

  // --- Departments --------------------------------------------------------
  const departmentIdByKey = new Map<string, string>();
  for (const department of config.departments) {
    const existing = await tx.department.findFirst({
      where: { organizationId, key: department.key },
    });
    const row = await upsertByKey(
      'department',
      existing,
      { name: department.name, active: true },
      () =>
        tx.department.create({
          data: {
            organizationId,
            key: department.key,
            name: department.name,
            createdById: actorUserId,
            updatedById: actorUserId,
          },
        }),
      (id) =>
        tx.department.update({
          where: { organizationId_id: { organizationId, id } },
          data: {
            name: department.name,
            active: true,
            updatedById: actorUserId,
            version: { increment: 1 },
          },
        }),
    );
    departmentIdByKey.set(department.key, row.id);
  }

  // --- Journeys and statuses ------------------------------------------------
  const journeyIdByKey = new Map<string, string>();
  const statusIdBySpelling = new Map<string, string>();
  const statusById: Resolved['statusById'] = new Map();
  for (const journey of config.journeys) {
    const existing = await tx.journey.findFirst({ where: { organizationId, key: journey.key } });
    const row = await upsertByKey(
      'journey',
      existing,
      { name: journey.name, active: true, restrictToMembers: journey.restrictToMembers },
      () =>
        tx.journey.create({
          data: {
            organizationId,
            key: journey.key,
            name: journey.name,
            restrictToMembers: journey.restrictToMembers,
            createdById: actorUserId,
            updatedById: actorUserId,
          },
        }),
      (id) =>
        tx.journey.update({
          where: { organizationId_id: { organizationId, id } },
          data: {
            name: journey.name,
            active: true,
            restrictToMembers: journey.restrictToMembers,
            updatedById: actorUserId,
            version: { increment: 1 },
          },
        }),
    );
    journeyIdByKey.set(journey.key, row.id);
    for (const [sortOrder, status] of journey.statuses.entries()) {
      const desired = {
        name: status.name,
        active: true,
        outcomeType: status.outcome,
        behaviorType: status.behavior,
        sortOrder,
        isDefaultOnCreate: status.isDefault === true,
        color: status.color ?? null,
        reasonOptions: status.reasons ?? [],
      };
      const current = await tx.status.findFirst({
        where: { organizationId, journeyId: row.id, key: status.key },
      });
      const saved = await upsertByKey(
        'status',
        current,
        desired,
        () =>
          tx.status.create({
            data: {
              organizationId,
              journeyId: row.id,
              key: status.key,
              ...desired,
              createdById: actorUserId,
              updatedById: actorUserId,
            },
          }),
        (id) =>
          tx.status.update({
            where: { organizationId_id: { organizationId, id } },
            data: { ...desired, updatedById: actorUserId, version: { increment: 1 } },
          }),
      );
      statusById.set(saved.id, {
        journeyKey: journey.key,
        key: status.key,
        outcome: status.outcome,
      });
      for (const spelling of [status.name, ...(status.aliases ?? [])])
        statusIdBySpelling.set(`${journey.key}:${nameLookupKey(spelling)}`, saved.id);
    }
    const unnamed = await tx.status.count({
      where: {
        organizationId,
        journeyId: row.id,
        active: true,
        key: { notIn: journey.statuses.map((s) => s.key) },
      },
    });
    if (unnamed > 0)
      report.configuration.notes.push(
        `${journey.key}: ${unnamed} active status(es) not in the config were left as they are.`,
      );
  }

  // --- Fields ---------------------------------------------------------------
  const fieldIdByKey = new Map<string, string>();
  const existingFieldCount = await tx.field.count({ where: { organizationId } });
  for (const [index, field] of config.fields.entries()) {
    const desired = {
      name: field.name,
      fieldType: field.type,
      validationRule: field.options?.length ? { options: field.options } : null,
      section: field.section ?? null,
      editMode: field.locked === true ? 'locked' : 'manual',
      active: true,
    };
    const existing = await tx.field.findFirst({ where: { organizationId, key: field.key } });
    const row = await upsertByKey(
      'field',
      existing,
      desired,
      () =>
        tx.field.create({
          data: {
            organizationId,
            key: field.key,
            ...desired,
            validationRule: (desired.validationRule ?? Prisma.DbNull) as never,
            source: 'import',
            sortOrder: existingFieldCount + index,
            createdById: actorUserId,
            updatedById: actorUserId,
          },
        }),
      (id) =>
        tx.field.update({
          where: { organizationId_id: { organizationId, id } },
          data: {
            ...desired,
            validationRule: (desired.validationRule ?? Prisma.DbNull) as never,
            updatedById: actorUserId,
            version: { increment: 1 },
          },
        }),
    );
    fieldIdByKey.set(field.key, row.id);
  }

  // --- Roles, permissions, journey access, reporting lines -----------------
  const roleIdByKey = new Map<string, string>();
  for (const role of config.roles) {
    const existing = await tx.role.findFirst({ where: { organizationId, key: role.key } });
    const row = await upsertByKey(
      'role',
      existing,
      { name: role.name, active: true },
      () =>
        tx.role.create({
          data: {
            organizationId,
            key: role.key,
            name: role.name,
            createdById: actorUserId,
            updatedById: actorUserId,
          },
        }),
      (id) =>
        tx.role.update({
          where: { organizationId_id: { organizationId, id } },
          data: {
            name: role.name,
            active: true,
            updatedById: actorUserId,
            version: { increment: 1 },
          },
        }),
    );
    roleIdByKey.set(role.key, row.id);
  }
  const adminRoleIds = (
    await tx.role.findMany({
      where: {
        organizationId,
        active: true,
        id: { notIn: [...roleIdByKey.values()] },
        permissions: { some: { module: 'roles_permissions', action: 'edit' } },
      },
      select: { id: true },
    })
  ).map((row) => row.id);

  const ids = (map: Map<string, string>, keys: readonly string[]) =>
    keys.map((key) => map.get(key)!);
  for (const role of config.roles) {
    const roleId = roleIdByKey.get(role.key)!;
    const permissions = role.permissions
      .map((permission) => ({
        module: permission.module,
        action: permission.action,
        scope: permission.scope,
        journeyIds: ids(journeyIdByKey, permission.journeys ?? []).sort(),
      }))
      .sort((a, b) => `${a.module}:${a.action}`.localeCompare(`${b.module}:${b.action}`));
    const currentPermissions = (
      await tx.rolePermission.findMany({
        where: { organizationId, roleId },
        select: { module: true, action: true, scope: true, journeyIds: true },
      })
    )
      .map((row) => ({ ...row, journeyIds: [...row.journeyIds].sort() }))
      .sort((a, b) => `${a.module}:${a.action}`.localeCompare(`${b.module}:${b.action}`));
    if (JSON.stringify(currentPermissions) !== JSON.stringify(permissions)) {
      await tx.rolePermission.deleteMany({ where: { organizationId, roleId } });
      if (permissions.length)
        await tx.rolePermission.createMany({
          data: permissions.map((p) => ({ organizationId, roleId, ...p })),
        });
      await audit('role_permissions', roleId, 'replace', currentPermissions, permissions);
      countConfig(report, 'updated', 'role_permissions');
    }
    const journeyIds = ids(journeyIdByKey, role.journeys).sort();
    const currentAccess = (
      await tx.roleJourneyAccess.findMany({
        where: { organizationId, roleId },
        select: { journeyId: true },
      })
    )
      .map((row) => row.journeyId)
      .sort();
    if (JSON.stringify(currentAccess) !== JSON.stringify(journeyIds)) {
      await tx.roleJourneyAccess.deleteMany({ where: { organizationId, roleId } });
      if (journeyIds.length)
        await tx.roleJourneyAccess.createMany({
          data: journeyIds.map((journeyId) => ({ organizationId, roleId, journeyId })),
        });
      await audit('role_journey_access', roleId, 'replace', currentAccess, journeyIds);
      countConfig(report, 'updated', 'role_journey_access');
    }
    const reportsTo = ids(roleIdByKey, role.reportsTo).sort();
    const currentLines = (
      await tx.roleReportingLine.findMany({
        where: { organizationId, roleId },
        select: { reportsToRoleId: true },
      })
    )
      .map((row) => row.reportsToRoleId)
      .sort();
    if (JSON.stringify(currentLines) !== JSON.stringify(reportsTo)) {
      await tx.roleReportingLine.deleteMany({ where: { organizationId, roleId } });
      if (reportsTo.length)
        await tx.roleReportingLine.createMany({
          data: reportsTo.map((reportsToRoleId) => ({ organizationId, roleId, reportsToRoleId })),
        });
      await audit('role_reporting_lines', roleId, 'replace', currentLines, reportsTo);
      countConfig(report, 'updated', 'role_reporting_lines');
    }
  }
  // The operator's own administrator role keeps reaching everything it configured.
  for (const roleId of adminRoleIds) {
    await tx.roleJourneyAccess.createMany({
      data: [...journeyIdByKey.values()].map((journeyId) => ({
        organizationId,
        roleId,
        journeyId,
      })),
      skipDuplicates: true,
    });
    await tx.fieldVisibility.createMany({
      data: [...fieldIdByKey.values()].map((fieldId) => ({
        organizationId,
        roleId,
        fieldId,
        accessLevel: 'EDIT' as const,
      })),
      skipDuplicates: true,
    });
  }

  // --- Field ↔ journey settings and per-role visibility ---------------------
  const allJourneyKeys = config.journeys.map((journey) => journey.key);
  for (const field of config.fields) {
    const fieldId = fieldIdByKey.get(field.key)!;
    const journeys = field.journeys === 'all' ? allJourneyKeys : field.journeys;
    for (const journeyKey of journeys) {
      const journeyId = journeyIdByKey.get(journeyKey)!;
      const desired = fieldSetting(field, roleIdByKey);
      const existing = await tx.fieldJourneySetting.findFirst({
        where: { organizationId, fieldId, journeyId },
      });
      await upsertByKey(
        'field_journey_setting',
        existing === null
          ? null
          : { ...existing, requiredRoleIds: [...existing.requiredRoleIds].sort() },
        desired,
        () =>
          tx.fieldJourneySetting.create({
            data: { organizationId, fieldId, journeyId, ...desired },
          }),
        (id) =>
          tx.fieldJourneySetting.update({
            where: { organizationId_id: { organizationId, id } },
            data: desired,
          }),
      );
    }
    const hidden = new Set(field.hiddenForRoles ?? []);
    const viewOnly = new Set(field.viewOnlyForRoles ?? []);
    for (const role of config.roles) {
      const roleId = roleIdByKey.get(role.key)!;
      const existing = await tx.fieldVisibility.findFirst({
        where: { organizationId, fieldId, roleId },
      });
      if (hidden.has(role.key)) {
        if (existing !== null) {
          await tx.fieldVisibility.delete({
            where: { organizationId_fieldId_roleId: { organizationId, fieldId, roleId } },
          });
          await audit('field_visibility', existing.id, 'delete', existing, null);
          countConfig(report, 'updated', 'field_visibility');
        }
        continue;
      }
      const accessLevel = viewOnly.has(role.key) ? ('VIEW' as const) : ('EDIT' as const);
      if (existing?.accessLevel === accessLevel) continue;
      const row = await tx.fieldVisibility.upsert({
        where: { organizationId_fieldId_roleId: { organizationId, fieldId, roleId } },
        create: { organizationId, fieldId, roleId, accessLevel },
        update: { accessLevel },
      });
      await audit(
        'field_visibility',
        row.id,
        existing === null ? 'create' : 'update',
        existing,
        row,
      );
      countConfig(report, existing === null ? 'created' : 'updated', 'field_visibility');
    }
  }

  // --- Status rules -----------------------------------------------------------
  for (const journey of config.journeys) {
    for (const status of journey.statuses) {
      const statusId = statusIdBySpelling.get(`${journey.key}:${nameLookupKey(status.name)}`)!;
      const allowed = ids(roleIdByKey, status.allowedRoles ?? []).sort();
      const required = ids(fieldIdByKey, status.requiredFields ?? []).sort();
      const [currentAllowed, currentRequired] = await Promise.all([
        tx.statusAllowedRole.findMany({
          where: { organizationId, statusId },
          select: { roleId: true },
        }),
        tx.statusRequiredField.findMany({
          where: { organizationId, statusId },
          select: { fieldId: true },
        }),
      ]);
      const before = {
        allowedRoleIds: currentAllowed.map((row) => row.roleId).sort(),
        requiredFieldIds: currentRequired.map((row) => row.fieldId).sort(),
      };
      const after = { allowedRoleIds: allowed, requiredFieldIds: required };
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      await tx.statusAllowedRole.deleteMany({ where: { organizationId, statusId } });
      await tx.statusRequiredField.deleteMany({ where: { organizationId, statusId } });
      if (allowed.length)
        await tx.statusAllowedRole.createMany({
          data: allowed.map((roleId) => ({ organizationId, statusId, roleId })),
        });
      if (required.length)
        await tx.statusRequiredField.createMany({
          data: required.map((fieldId) => ({ organizationId, statusId, fieldId })),
        });
      await audit('status_rules', statusId, 'replace', before, after);
      countConfig(report, 'updated', 'status_rules');
    }
  }

  // --- Users -------------------------------------------------------------------
  const roleKeyBySourceName = new Map(
    config.roles.map((role) => [nameLookupKey(role.sourceName), role.key]),
  );
  const departmentByRole = new Map(config.roles.map((role) => [role.key, role.department]));
  report.users.source = input.users.length;
  for (const user of input.users) {
    const existing = await tx.user.findFirst({ where: { organizationId, email: user.email } });
    if (existing !== null) {
      report.users.existing += 1;
      continue;
    }
    const roleKey = roleKeyBySourceName.get(nameLookupKey(user.roleName));
    if (roleKey === undefined) {
      report.users.unknownRoles.push({ email: user.email, roleName: user.roleName });
      continue;
    }
    const departmentKey = departmentByRole.get(roleKey);
    const created = await tx.user.create({
      data: {
        organizationId,
        name: user.name,
        email: user.email,
        roleId: roleIdByKey.get(roleKey)!,
        departmentId:
          departmentKey === undefined ? null : (departmentIdByKey.get(departmentKey) ?? null),
        active: user.active,
        passwordHash: null,
      },
    });
    await audit('user', created.id, 'create', null, {
      name: user.name,
      email: user.email,
      role: roleKey,
      active: user.active,
    });
    report.users.created += 1;
    if (!user.active) report.users.inactive += 1;
  }

  const allUsers = await tx.user.findMany({
    where: { organizationId },
    select: { id: true, name: true, email: true, active: true },
  });
  const userIdsByName: Resolved['userIdsByName'] = new Map();
  for (const user of allUsers) {
    const key = nameLookupKey(user.name);
    const list = userIdsByName.get(key) ?? [];
    list.push({ id: user.id, active: user.active });
    userIdsByName.set(key, list);
  }
  report.users.ambiguousNames = [...userIdsByName]
    .filter(([, list]) => list.length > 1)
    .map(([name]) => name);
  const resolved: Resolved = {
    roleIdByKey,
    fieldIdByKey,
    journeyIdByKey,
    statusIdBySpelling,
    statusById,
    userIdsByName,
    userIdByEmail: new Map(allUsers.map((user) => [user.email.toLowerCase(), user.id])),
    placeholderUserIds: new Set(
      allUsers
        .filter((user) => user.email.toLowerCase().endsWith(`@${config.placeholderEmailDomain}`))
        .map((user) => user.id),
    ),
    adminRoleIds,
  };

  // --- Journey members ------------------------------------------------------------
  const adminUserIds = (
    await tx.user.findMany({
      where: { organizationId, roleId: { in: adminRoleIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  for (const journey of config.journeys) {
    const journeyId = journeyIdByKey.get(journey.key)!;
    const memberIds = new Set<string>([actorUserId, ...adminUserIds]);
    for (const name of journey.members) {
      const userId = resolveUserByName(resolved, name);
      if (userId === null || resolved.placeholderUserIds.has(userId))
        report.users.unresolvedMembers.push({ journey: journey.key, name });
      else memberIds.add(userId);
    }
    const current = new Set(
      (
        await tx.journeyMember.findMany({
          where: { organizationId, journeyId },
          select: { userId: true },
        })
      ).map((row) => row.userId),
    );
    const missing = [...memberIds].filter((id) => !current.has(id));
    if (missing.length) {
      await tx.journeyMember.createMany({
        data: missing.map((userId) => ({ organizationId, journeyId, userId })),
      });
      await audit('journey_members', journeyId, 'add', null, { added: missing.length });
      countConfig(report, 'updated', 'journey_members');
    }
  }

  // --- Auto-assignment (status routing, round robin over named users) ------------
  for (const journey of config.journeys) {
    const journeyId = journeyIdByKey.get(journey.key)!;
    for (const status of journey.statuses) {
      if (!status.autoAssign?.length) continue;
      const statusId = statusIdBySpelling.get(`${journey.key}:${nameLookupKey(status.name)}`)!;
      const userIds: string[] = [];
      for (const name of status.autoAssign) {
        const userId = resolveUserByName(resolved, name, true);
        if (userId === null)
          report.users.unresolvedAutoAssign.push({
            journey: journey.key,
            status: status.key,
            name,
          });
        else userIds.push(userId);
      }
      if (userIds.length === 0) continue;
      const existing = await tx.statusRoutingRule.findFirst({
        where: { organizationId, statusId },
      });
      if (existing !== null) continue; // an admin may have tuned it since; never overwrite
      const rule = await tx.statusRoutingRule.create({
        data: {
          organizationId,
          journeyId,
          statusId,
          assignmentType: config.assignmentTypes.owner,
          algorithm: 'round_robin',
          poolType: 'users',
          createdById: actorUserId,
          updatedById: actorUserId,
        },
      });
      await tx.statusRoutingRuleMember.createMany({
        data: userIds.map((userId) => ({ organizationId, ruleId: rule.id, userId })),
      });
      await audit('status_routing_rule', rule.id, 'create', null, {
        statusId,
        userCount: userIds.length,
      });
      countConfig(report, 'created', 'status_routing_rule');
    }
  }
  return resolved;
}

function fieldSetting(field: FieldConfig, roleIdByKey: Map<string, string>) {
  const required = field.requiredOnCreateForRoles;
  if (required === undefined || (Array.isArray(required) && required.length === 0))
    return {
      requirement: 'optional',
      requiredRoleIds: [] as string[],
      requiredFromStatusId: null,
      active: true,
    };
  return {
    requirement: 'required_on_create',
    requiredRoleIds: required === 'all' ? [] : required.map((key) => roleIdByKey.get(key)!).sort(),
    requiredFromStatusId: null,
    active: true,
  };
}

/**
 * A user by display name. With several users of one name, the single active
 * one wins; otherwise the first. `activeOnly` refuses an inactive match
 * (auto-assignment must never route to someone who cannot log in).
 */
export function resolveUserByName(
  resolved: Resolved,
  name: string,
  activeOnly = false,
): string | null {
  const list = resolved.userIdsByName.get(nameLookupKey(name)) ?? [];
  const active = list.filter((user) => user.active);
  if (active.length >= 1) return active[0]!.id;
  if (activeOnly) return null;
  return list[0]?.id ?? null;
}
