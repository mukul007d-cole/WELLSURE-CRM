import { readFile } from 'node:fs/promises';

import { afterAll, describe, expect, it } from 'vitest';

import { runCutover, type CutoverOptions } from '../cutover/cli.js';
import { parseCutoverConfig } from '../cutover/config.js';
import type { SourceFile } from '../cutover/migrate-leads.js';
import type { SourceUser } from '../cutover/sources.js';
import {
  applyMigrations,
  createAdminPostgres,
  shouldRunAdminPostgres,
} from './fixtures/synthetic-admin.js';

let cleanup: (() => Promise<void>) | undefined;
afterAll(async () => cleanup?.());

const users: SourceUser[] = [
  {
    name: 'Example Manager One',
    email: 'manager.one@example.test',
    roleName: 'Example Manager',
    active: true,
  },
  {
    name: 'Example Executive One',
    email: 'executive.one@example.test',
    roleName: 'Example Executive',
    active: true,
  },
  {
    name: 'Example Operator One',
    email: 'operator.one@example.test',
    roleName: 'Example Operator',
    active: true,
  },
  {
    name: 'Example Blocked',
    email: 'blocked@example.test',
    roleName: 'Example Executive',
    active: false,
  },
];

const pipelineRows = [
  {
    record_id: '1',
    name: 'Example Seller A',
    mobile: "'9876500001",
    email: 'seller.a@example.test',
    tax_id: '22AAAAA0000A1Z5',
    status: 'Example Reached',
    owner: 'Example Executive One',
    previous_owner: 'Example Manager One',
    tier: '[gold]',
    order_value: '1,000',
    created: '2026-07-01 10:00:00',
    follow_up: '2099-01-01 10:00:00',
    remarks:
      '2026-07-02 11:00:00 :- First call (Example Executive One)<br/>2026-07-03 12:00:00 :- Second call (Someone Unknown)<br/>',
  },
  {
    record_id: '2',
    mobile: '9876500002',
    status: 'example new',
    owner: 'Former Person',
    created: '2026-07-01 11:00:00',
  },
  {
    record_id: '3',
    name: 'Example Seller C',
    status: 'Status Nobody Configured',
    owner: 'Example Executive One',
  },
  {
    record_id: '4',
    name: 'Different Business',
    mobile: '9876500001',
    status: 'Example New',
    owner: 'Example Executive One',
    tier: 'Platinum',
  },
];
const onboardingRows = [
  {
    record_id: '11',
    name: 'example seller a',
    mobile: '+91 98765 00001',
    status: 'Example Waiting',
    owner: 'Example Operator One',
    services: '[Listing, Advertising]',
    created: '2026-08-01 10:00:00',
  },
];
const files = (): SourceFile[] => [
  {
    journeyKey: 'example_pipeline',
    path: 'pipeline.xlsx',
    headers: Object.keys(pipelineRows[0]!),
    rows: pipelineRows,
  },
  {
    journeyKey: 'example_onboarding',
    path: 'onboarding.xlsx',
    headers: Object.keys(onboardingRows[0]!),
    rows: onboardingRows,
  },
];

describe.runIf(shouldRunAdminPostgres)('cutover against real Postgres', () => {
  it('dry-runs without a trace, commits exactly, and re-runs as a no-op', async () => {
    const db = await createAdminPostgres();
    cleanup = db.cleanup;
    await applyMigrations(db.sql);
    const organizationId = (
      await db.prisma.organization.create({ data: { name: 'Synthetic Cutover Org' } })
    ).id;
    const adminRole = await db.prisma.role.create({
      data: { organizationId, key: 'synthetic_admin', name: 'Synthetic Admin' },
    });
    await db.prisma.rolePermission.create({
      data: {
        organizationId,
        roleId: adminRole.id,
        module: 'roles_permissions',
        action: 'edit',
        scope: 'ORGANIZATION',
      },
    });
    const admin = await db.prisma.user.create({
      data: {
        organizationId,
        roleId: adminRole.id,
        name: 'Synthetic Admin',
        email: 'admin@example.test',
      },
    });
    const config = parseCutoverConfig(
      JSON.parse(
        await readFile(
          new URL('../../../../docs/migration/cutover-config.example.json', import.meta.url),
          'utf8',
        ),
      ),
    );
    const options = (commit: boolean): CutoverOptions => ({
      configPath: 'unused',
      exports: [],
      actorEmail: 'admin@example.test',
      organizationId,
      commit,
      sendInvites: false,
      reportPrefix: 'unused',
    });
    const run = (commit: boolean) =>
      runCutover(options(commit), db.prisma, { config, users, files: files() });

    // --- Dry run: the report is complete, the database untouched. ----------
    const dry = await run(false);
    expect(dry.totals).toEqual({
      source: 5,
      leadsCreated: 3,
      processInstancesCreated: 4,
      alreadyMigrated: 0,
      rejected: 1,
    });
    expect(await db.prisma.lead.count({ where: { organizationId } })).toBe(0);
    expect(await db.prisma.journey.count({ where: { organizationId } })).toBe(0);
    expect(await db.prisma.user.count({ where: { organizationId } })).toBe(1);

    // --- Commit. --------------------------------------------------------------
    const report = await run(true);
    expect(report.totals).toEqual(dry.totals);
    const pipeline = report.files.find((file) => file.journey === 'example_pipeline')!;
    expect(pipeline.unmappedStatuses).toEqual({ 'Status Nobody Configured': 1 });
    expect(pipeline.droppedValues.example_tier).toMatchObject({
      count: 1,
      reasons: { 'not one of the options': 1 },
    });
    expect(report.merges.crossJourneyLeads).toBe(1);
    expect(report.merges.review).toContainEqual({
      reason: 'same phone, several records in one journey',
      externalRefs: ['legacy_crm:1', 'legacy_crm:4', 'legacy_crm:11'],
    });
    expect(report.merges.review).toContainEqual({
      reason: 'same phone, different identity',
      externalRefs: ['legacy_crm:4', 'legacy_crm:11'],
    });
    expect(report.users).toMatchObject({ created: 4, inactive: 1 });
    expect(report.users.placeholders).toEqual([
      {
        name: 'Former Person',
        email: 'former.former.person@former-users.invalid',
        ownedRecords: 1,
      },
    ]);

    // One lead for record 1 and record 11 (phone + name match across journeys).
    const merged = await db.prisma.processInstance.findMany({
      where: { organizationId, externalRef: { in: ['legacy_crm:1', 'legacy_crm:11'] } },
      include: {
        lead: true,
        currentStatus: { select: { key: true } },
        assignments: {
          select: { assignmentType: true, isCurrent: true, user: { select: { email: true } } },
        },
      },
      orderBy: { externalRef: 'asc' },
    });
    expect(new Set(merged.map((row) => row.leadId)).size).toBe(1);
    const [first, eleventh] = merged;
    expect(first!.currentStatus.key).toBe('example_contacted');
    expect(first!.lead).toMatchObject({ name: 'example seller a', phone: '+919876500001' });
    const fields = Object.fromEntries(
      (
        await db.prisma.field.findMany({
          where: { organizationId },
          select: { id: true, key: true },
        })
      ).map((f) => [f.key, f.id]),
    );
    expect(first!.lead.fieldValues).toEqual({
      [fields.example_tax_id!]: '22AAAAA0000A1Z5',
      [fields.example_tier!]: 'Gold',
      [fields.example_order_value!]: 1000,
      [fields.example_services!]: ['Listing', 'Advertising'],
    });
    expect(first!.assignments).toEqual(
      expect.arrayContaining([
        { assignmentType: 'owner', isCurrent: true, user: { email: 'executive.one@example.test' } },
        {
          assignmentType: 'previous_owner',
          isCurrent: false,
          user: { email: 'manager.one@example.test' },
        },
      ]),
    );
    expect(eleventh!.assignments).toEqual([
      { assignmentType: 'owner', isCurrent: true, user: { email: 'operator.one@example.test' } },
    ]);

    // Former owner → inactive placeholder; nameless record named from its phone.
    const second = await db.prisma.processInstance.findFirstOrThrow({
      where: { organizationId, externalRef: 'legacy_crm:2' },
      include: { lead: true, assignments: { include: { user: true } } },
    });
    expect(second.lead.name).toBe('9876500002');
    expect(second.assignments[0]!.user).toMatchObject({
      active: false,
      email: 'former.former.person@former-users.invalid',
    });

    // Remarks → backdated comments; an unknown author keeps their name in the text.
    const comments = await db.prisma.activityLog.findMany({
      where: { organizationId, processInstanceId: first!.id, actionType: 'comment' },
      orderBy: { timestamp: 'asc' },
    });
    expect(
      comments.map((row) => [
        row.source,
        row.commentText,
        row.actorUserId !== null,
        row.timestamp.toISOString(),
      ]),
    ).toEqual([
      ['migrated_legacy_crm_remark', 'First call', true, '2026-07-02T05:30:00.000Z'],
      [
        'migrated_legacy_crm_remark',
        'Second call (Someone Unknown)',
        false,
        '2026-07-03T06:30:00.000Z',
      ],
    ]);
    expect(
      await db.prisma.task.count({
        where: { organizationId, processInstanceId: first!.id, type: 'follow_up', status: 'open' },
      }),
    ).toBe(1);

    // Configuration: rules, members, reporting lines, auto-assignment.
    const onboarding = await db.prisma.journey.findFirstOrThrow({
      where: { organizationId, key: 'example_onboarding' },
      include: { members: { include: { user: { select: { email: true } } } } },
    });
    expect(onboarding.restrictToMembers).toBe(true);
    expect(onboarding.members.map((m) => m.user.email).sort()).toEqual([
      'admin@example.test',
      'manager.one@example.test',
      'operator.one@example.test',
    ]);
    const contacted = await db.prisma.status.findFirstOrThrow({
      where: { organizationId, key: 'example_contacted' },
      include: { allowedRoles: { include: { role: { select: { key: true } } } } },
    });
    expect(contacted).toMatchObject({
      color: 'purple',
      reasonOptions: ['Example Hot', 'Example Cold'],
    });
    expect(contacted.allowedRoles.map((row) => row.role.key).sort()).toEqual([
      'example_executive',
      'example_manager',
    ]);
    const won = await db.prisma.statusRoutingRule.findFirstOrThrow({
      where: { organizationId, status: { key: 'example_won' } },
      include: { members: { include: { user: { select: { email: true } } } } },
    });
    expect(won.members.map((m) => m.user.email)).toEqual(['manager.one@example.test']);
    const executive = await db.prisma.role.findFirstOrThrow({
      where: { organizationId, key: 'example_executive' },
      include: { reportsTo: { include: { reportsTo: { select: { key: true } } } } },
    });
    expect(executive.reportsTo.map((row) => row.reportsTo.key)).toEqual(['example_manager']);
    const exportGrant = await db.prisma.rolePermission.findFirstOrThrow({
      where: {
        organizationId,
        module: 'leads',
        action: 'export',
        role: { key: 'example_manager' },
      },
    });
    expect(exportGrant.journeyIds).toEqual([
      (
        await db.prisma.journey.findFirstOrThrow({
          where: { organizationId, key: 'example_pipeline' },
        })
      ).id,
    ]);
    const executiveVisibility = await db.prisma.fieldVisibility.findMany({
      where: { organizationId, roleId: executive.id },
      include: { field: { select: { key: true } } },
    });
    expect(
      Object.fromEntries(executiveVisibility.map((row) => [row.field.key, row.accessLevel])),
    ).toEqual({
      example_tax_id: 'EDIT',
      example_tier: 'EDIT',
      example_order_value: 'EDIT',
      example_launch_date: 'VIEW',
    });
    // The administrator running the cutover keeps reaching what it configured.
    expect(
      await db.prisma.roleJourneyAccess.count({ where: { organizationId, roleId: adminRole.id } }),
    ).toBe(2);
    expect(
      await db.prisma.systemAuditLog.count({
        where: { organizationId, actorUserId: admin.id, action: { startsWith: 'cutover.' } },
      }),
    ).toBeGreaterThan(20);

    // --- Re-run: a no-op for everything already there. ------------------------
    const counts = async () => ({
      leads: await db.prisma.lead.count({ where: { organizationId } }),
      activities: await db.prisma.activityLog.count({ where: { organizationId } }),
      users: await db.prisma.user.count({ where: { organizationId } }),
      audits: await db.prisma.systemAuditLog.count({ where: { organizationId } }),
    });
    const before = await counts();
    const again = await run(true);
    expect(again.totals).toEqual({
      source: 5,
      leadsCreated: 0,
      processInstancesCreated: 0,
      alreadyMigrated: 4,
      rejected: 1,
    });
    expect(again.configuration).toMatchObject({ created: {}, updated: {} });
    expect(await counts()).toEqual(before);
  });
});
