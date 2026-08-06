/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { afterAll, describe, expect, it } from 'vitest';
import type { PermissionRepository } from '@falcon/permission-engine';

import { PrismaLeadRepository, type PrismaLeadClient } from '../leads/prisma-lead-repository.js';
import { createLead, editLead, getSeller360, listSellers } from '../routes/leads.js';
import { createPostgresDatabase, shouldRunPostgresIntegration } from './fixtures/synthetic-auth.js';
import type postgres from 'postgres';

const orgId = '11111111-1111-1111-1111-111111111111';
const roleId = '22222222-2222-2222-2222-222222222222';
const actorId = '33333333-3333-3333-3333-333333333333';
const otherUserId = '33333333-3333-3333-3333-333333333334';
const journeyA = '44444444-4444-4444-4444-444444444444';
const journeyB = '44444444-4444-4444-4444-444444444445';
const statusA = '55555555-5555-5555-5555-555555555555';
const statusB = '55555555-5555-5555-5555-555555555556';
const fieldA = '66666666-6666-6666-6666-666666666666';
const fieldB = '66666666-6666-6666-6666-666666666667';
const assignmentType = 'synthetic_owner';
const now = new Date('2026-01-01T00:00:00.000Z');

let cleanup: (() => Promise<void>) | undefined;
afterAll(async () => cleanup?.());

describe.runIf(shouldRunPostgresIntegration)('Lead/Seller core against real Postgres', () => {
  it('creates and edits leads atomically with process instances, assignments, JSONB field values, and activity logs', async () => {
    const database = await createPostgresDatabase();
    cleanup = database.cleanup;
    await setupLeadSchema(database.sql);
    const repository = new PrismaLeadRepository(createPrismaLikeClient(database.sql));
    const created = await createLead({
      auth: auth(),
      leadRepository: repository,
      permissionRepository: permissionRepository({
        editableFields: [fieldA],
        visibleFields: [fieldA],
      }),
      journeyId: journeyA,
      statusId: statusA,
      name: 'Synthetic Seller One',
      email: 'seller-one@example.test',
      fieldValues: { [fieldA]: 'initial' },
      assignments: [{ assignmentType, userId: actorId }],
      now,
    });
    expect(created.status).toBe(201);
    const createdBody = created.body as { lead: { id: string }; process: { id: string } };

    const rowCounts = await counts(database.sql, createdBody.lead.id);
    expect(rowCounts).toEqual({ leads: 1, processes: 1, assignments: 1, activities: 1 });

    const edited = await editLead({
      auth: auth(),
      leadRepository: repository,
      permissionRepository: permissionRepository({
        editableFields: [fieldA],
        visibleFields: [fieldA],
      }),
      processInstanceId: createdBody.process.id,
      journeyId: journeyA,
      leadId: createdBody.lead.id,
      assignmentTypes: [assignmentType],
      name: 'Synthetic Seller Updated',
      fieldValues: { [fieldA]: 'updated' },
      statusId: statusB,
      now,
    });
    expect(edited.status).toBe(200);
    const activities = await database.sql<{ action_type: string }[]>`
      SELECT action_type FROM activity_logs WHERE organization_id = ${orgId} AND lead_id = ${createdBody.lead.id} ORDER BY timestamp ASC
    `;
    expect(activities.map((row) => row.action_type)).toEqual([
      'field_edit',
      'field_edit',
      'status_change',
    ]);
  });

  it('supports multi-Journey Seller List parity and Seller 360 field visibility union against real Postgres', async () => {
    const database = await createPostgresDatabase();
    cleanup = database.cleanup;
    await setupLeadSchema(database.sql);
    const repository = new PrismaLeadRepository(createPrismaLikeClient(database.sql));
    const created = await createLead({
      auth: auth(),
      leadRepository: repository,
      permissionRepository: permissionRepository({
        editableFields: [fieldA],
        visibleFields: [fieldA],
      }),
      journeyId: journeyA,
      statusId: statusA,
      name: 'Synthetic Aggregate Seller',
      fieldValues: { [fieldA]: 'journey a value' },
      assignments: [{ assignmentType, userId: actorId }],
      now,
    });
    expect(created.status).toBe(201);
    const leadId = (created.body as { lead: { id: string } }).lead.id;
    const attached = await createLead({
      auth: auth(),
      leadRepository: repository,
      permissionRepository: permissionRepository({
        journeys: [journeyA, journeyB],
        editableFields: [fieldB],
        visibleFields: [fieldB],
      }),
      existingLeadId: leadId,
      journeyId: journeyB,
      statusId: statusA,
      name: 'Synthetic Aggregate Seller',
      fieldValues: { [fieldB]: 'journey b value' },
      assignments: [{ assignmentType, userId: actorId }],
      now,
    });
    expect(attached.status).toBe(201);

    const list = await listSellers({
      auth: auth(),
      sellerRepository: repository,
      permissionRepository: permissionRepository({
        journeys: [journeyA, journeyB],
        visibleFields: [fieldA, fieldB],
      }),
      list: {
        requestedFieldIds: [fieldA, fieldB],
        assignmentTypes: [assignmentType],
        page: 1,
        pageSize: 10,
      },
      now,
    });
    expect(list.status).toBe(200);
    expect((list.body as { total: number; rows: unknown[] }).total).toBe(1);
    expect((list.body as { total: number; rows: unknown[] }).rows).toHaveLength(1);

    const detail = await getSeller360({
      auth: auth(),
      sellerRepository: repository,
      permissionRepository: permissionRepository({
        journeys: [journeyA, journeyB],
        visibleFields: [fieldA, fieldB],
      }),
      leadId,
      requestedFieldIds: [fieldA, fieldB],
      assignmentTypes: [assignmentType],
      now,
    });
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      fieldValues: { [fieldA]: 'journey a value', [fieldB]: 'journey b value' },
    });
  });
});

describe.skipIf(shouldRunPostgresIntegration)('Lead/Seller core against real Postgres', () => {
  it('requires Docker/Testcontainers or FALCON_POSTGRES_URL to execute', () => {
    expect(shouldRunPostgresIntegration).toBe(false);
  });
});

async function setupLeadSchema(sql: postgres.Sql): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`;
  await sql.unsafe(
    `DO $$ BEGIN CREATE TYPE "DataScope" AS ENUM ('SELF', 'TEAM', 'DEPARTMENT', 'ORGANIZATION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  );
  await sql.unsafe(
    `DO $$ BEGIN CREATE TYPE "FieldAccessLevel" AS ENUM ('VIEW', 'EDIT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  );
  await sql`CREATE TEMP TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL)`;
  await sql`CREATE TEMP TABLE roles (id uuid NOT NULL, organization_id uuid NOT NULL, key text NOT NULL, name text NOT NULL, active boolean NOT NULL, version integer NOT NULL, PRIMARY KEY (organization_id, id))`;
  await sql`CREATE TEMP TABLE users (id uuid NOT NULL, organization_id uuid NOT NULL, name text NOT NULL, email text NOT NULL, role_id uuid NOT NULL, department_id uuid, manager_id uuid, active boolean NOT NULL, PRIMARY KEY (organization_id, id))`;
  await sql`CREATE TEMP TABLE role_permissions (organization_id uuid NOT NULL, role_id uuid NOT NULL, module text NOT NULL, action text NOT NULL, scope "DataScope" NOT NULL)`;
  await sql`CREATE TEMP TABLE journeys (id uuid NOT NULL, organization_id uuid NOT NULL, key text NOT NULL, name text NOT NULL, active boolean NOT NULL, PRIMARY KEY (organization_id, id))`;
  await sql`CREATE TEMP TABLE role_journey_access (organization_id uuid NOT NULL, role_id uuid NOT NULL, journey_id uuid NOT NULL)`;
  await sql`CREATE TEMP TABLE statuses (id uuid NOT NULL, organization_id uuid NOT NULL, journey_id uuid NOT NULL, key text NOT NULL, name text NOT NULL, active boolean NOT NULL, is_default_on_create boolean NOT NULL, sort_order integer NOT NULL)`;
  await sql`CREATE TEMP TABLE fields (id uuid NOT NULL, organization_id uuid NOT NULL, key text NOT NULL, name text NOT NULL, field_type text NOT NULL, validation_rule jsonb, active boolean NOT NULL, PRIMARY KEY (organization_id, id))`;
  await sql`CREATE TEMP TABLE field_journey_settings (organization_id uuid NOT NULL, field_id uuid NOT NULL, journey_id uuid NOT NULL, requirement text NOT NULL, required_from_status_id uuid, active boolean NOT NULL)`;
  await sql`CREATE TEMP TABLE field_visibility (organization_id uuid NOT NULL, field_id uuid NOT NULL, role_id uuid NOT NULL, access_level "FieldAccessLevel" NOT NULL)`;
  await sql`CREATE TEMP TABLE leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, name text NOT NULL, phone text, email text, field_values jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TEMP TABLE process_instances (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, lead_id uuid NOT NULL, journey_id uuid NOT NULL, current_status_id uuid NOT NULL, is_primary boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE UNIQUE INDEX process_instances_active_membership_uq_test ON process_instances (organization_id, lead_id, journey_id) WHERE active`;
  await sql`CREATE TEMP TABLE assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, process_instance_id uuid NOT NULL, assignment_type text NOT NULL, user_id uuid NOT NULL, assigned_at timestamptz NOT NULL DEFAULT now(), is_current boolean NOT NULL DEFAULT true)`;
  await sql`CREATE TEMP TABLE activity_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, lead_id uuid NOT NULL, process_instance_id uuid, actor_user_id uuid, timestamp timestamptz NOT NULL DEFAULT now(), action_type text NOT NULL, source text NOT NULL, old_value jsonb, new_value jsonb)`;
  await sql`CREATE TEMP TABLE user_access_grants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, user_id uuid NOT NULL, lead_id uuid NOT NULL, expires_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`INSERT INTO organizations (id, name) VALUES (${orgId}, 'Synthetic Org')`;
  await sql`INSERT INTO roles (id, organization_id, key, name, active, version) VALUES (${roleId}, ${orgId}, 'synthetic_role', 'Synthetic Role', true, 1)`;
  await sql`INSERT INTO users (id, organization_id, name, email, role_id, active) VALUES (${actorId}, ${orgId}, 'Synthetic Actor', 'actor@example.test', ${roleId}, true), (${otherUserId}, ${orgId}, 'Synthetic Other', 'other@example.test', ${roleId}, true)`;
  await sql`INSERT INTO journeys (id, organization_id, key, name, active) VALUES (${journeyA}, ${orgId}, 'synthetic_a', 'Synthetic A', true), (${journeyB}, ${orgId}, 'synthetic_b', 'Synthetic B', true)`;
  await sql`INSERT INTO statuses (id, organization_id, journey_id, key, name, active, is_default_on_create, sort_order) VALUES (${statusA}, ${orgId}, ${journeyA}, 'synthetic_status_a', 'Synthetic Status A', true, true, 1), (${statusB}, ${orgId}, ${journeyA}, 'synthetic_status_b', 'Synthetic Status B', true, false, 2), (${statusA}, ${orgId}, ${journeyB}, 'synthetic_status_a', 'Synthetic Status A', true, true, 1)`;
  await sql`INSERT INTO fields (id, organization_id, key, name, field_type, validation_rule, active) VALUES (${fieldA}, ${orgId}, 'synthetic_field_a', 'Synthetic Field A', 'text', null, true), (${fieldB}, ${orgId}, 'synthetic_field_b', 'Synthetic Field B', 'text', null, true)`;
  await sql`INSERT INTO field_journey_settings (organization_id, field_id, journey_id, requirement, active) VALUES (${orgId}, ${fieldA}, ${journeyA}, 'optional', true), (${orgId}, ${fieldB}, ${journeyB}, 'optional', true)`;
}

function auth() {
  return {
    session: {
      id: 'session',
      organizationId: orgId,
      userId: actorId,
      tokenHash: 'hash',
      createdAt: now,
      expiresAt: now,
      revokedAt: null,
      lastSeenAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: actorId,
      organizationId: orgId,
      roleId,
      active: true,
      departmentId: null,
      managerId: null,
    },
  };
}

function permissionRepository(input: {
  journeys?: string[];
  visibleFields?: string[];
  editableFields?: string[];
}): PermissionRepository {
  const journeys = input.journeys ?? [journeyA];
  return {
    async getUser() {
      return auth().user;
    },
    async getRole() {
      return { id: roleId, organizationId: orgId, active: true, version: 1 };
    },
    async getRolePermission(request) {
      return { module: request.module, action: request.action, scope: 'ORGANIZATION' };
    },
    async hasJourneyAccess(request) {
      return journeys.includes(request.journeyId);
    },
    async listAccessibleJourneyIds() {
      return journeys;
    },
    async getFieldVisibility(request) {
      return request.fieldIds
        .filter((fieldId) =>
          [...(input.visibleFields ?? []), ...(input.editableFields ?? [])].includes(fieldId),
        )
        .map((fieldId) => ({
          fieldId,
          accessLevel: input.editableFields?.includes(fieldId) ? 'EDIT' : 'VIEW',
        }));
    },
    async getLeadScope() {
      return null;
    },
    async listActiveUserIds() {
      return [actorId, otherUserId];
    },
    async listDepartmentUserIds() {
      return [actorId, otherUserId];
    },
    async listReports() {
      return [];
    },
    async listCurrentAssignments(request) {
      return [
        {
          leadId: '',
          processInstanceId: '',
          assignmentType,
          userId: actorId,
          organizationId: orgId,
          isCurrent: true,
          journeyId: request.journeyIds?.[0] ?? journeyA,
        },
      ];
    },
    async getActiveDirectGrant() {
      return null;
    },
  };
}

async function counts(sql: postgres.Sql, leadId: string) {
  const [row] = await sql<
    { leads: number; processes: number; assignments: number; activities: number }[]
  >`
    SELECT
      (SELECT count(*)::int FROM leads WHERE id = ${leadId}) AS leads,
      (SELECT count(*)::int FROM process_instances WHERE lead_id = ${leadId}) AS processes,
      (SELECT count(*)::int FROM assignments a JOIN process_instances p ON p.id = a.process_instance_id WHERE p.lead_id = ${leadId}) AS assignments,
      (SELECT count(*)::int FROM activity_logs WHERE lead_id = ${leadId}) AS activities
  `;
  return row!;
}

function createPrismaLikeClient(sql: postgres.Sql): PrismaLeadClient {
  const client: PrismaLeadClient = {
    async $transaction<T>(work: (tx: any) => Promise<T>): Promise<T> {
      return sql.begin(async (transaction) =>
        work(createPrismaLikeClient(transaction as unknown as postgres.Sql)),
      ) as Promise<T>;
    },
    journey: {
      async findUnique(args) {
        const id = (args as any).where.organizationId_id.id;
        const [row] = await sql<
          { id: string; active: boolean }[]
        >`SELECT id, active FROM journeys WHERE organization_id=${orgId} AND id=${id}`;
        return row ?? null;
      },
    },
    status: {
      async findUnique(args) {
        const where = (args as any).where.organizationId_journeyId_id;
        const [row] = await sql<
          { id: string; active: boolean; isDefaultOnCreate: boolean }[]
        >`SELECT id, active, is_default_on_create AS "isDefaultOnCreate" FROM statuses WHERE organization_id=${where.organizationId} AND journey_id=${where.journeyId} AND id=${where.id}`;
        return row ?? null;
      },
      async findFirst(args) {
        const where = (args as any).where;
        const [row] = await sql<
          { id: string; active: boolean; isDefaultOnCreate: boolean }[]
        >`SELECT id, active, is_default_on_create AS "isDefaultOnCreate" FROM statuses WHERE organization_id=${where.organizationId} AND journey_id=${where.journeyId} AND is_default_on_create=true ORDER BY sort_order LIMIT 1`;
        return row ?? null;
      },
    },
    fieldJourneySetting: {
      async findMany(args) {
        const where = (args as any).where;
        return sql<
          any[]
        >`SELECT fjs.field_id AS "fieldId", fjs.journey_id AS "journeyId", fjs.requirement, fjs.required_from_status_id AS "requiredFromStatusId", fjs.active, jsonb_build_object('id', f.id, 'fieldType', f.field_type, 'validationRule', f.validation_rule, 'active', f.active) AS field FROM field_journey_settings fjs JOIN fields f ON f.organization_id=fjs.organization_id AND f.id=fjs.field_id WHERE fjs.organization_id=${where.organizationId} AND fjs.journey_id=${where.journeyId} AND fjs.active=true`;
      },
    },
    lead: {
      async findUnique(args) {
        const where = (args as any).where.organizationId_id;
        const [lead] = await sql<
          any[]
        >`SELECT id, organization_id AS "organizationId", name, phone, email, field_values AS "fieldValues", created_at AS "createdAt", updated_at AS "updatedAt" FROM leads WHERE organization_id=${where.organizationId} AND id=${where.id}`;
        if (!lead) return null;
        if ((args as any).include?.processInstances)
          lead.processInstances = await loadProcesses(sql, where.organizationId, where.id);
        return lead;
      },
      async findMany(args) {
        const where = (args as any).where;
        const ids = await permittedLeadIds(
          sql,
          where,
          (args as any).skip ?? 0,
          (args as any).take ?? 25,
        );
        const rows = [];
        for (const id of ids) {
          const [lead] = await sql<
            any[]
          >`SELECT id, organization_id AS "organizationId", name, phone, email, field_values AS "fieldValues", created_at AS "createdAt", updated_at AS "updatedAt" FROM leads WHERE id=${id}`;
          lead.processInstances = await loadProcesses(sql, where.organizationId, id);
          rows.push(lead);
        }
        return rows;
      },
      async count(args) {
        const where = (args as any).where;
        const ids = await permittedLeadIds(sql, where, 0, 1000);
        return ids.length;
      },
      async create(args) {
        const data = (args as any).data;
        const [row] = await sql<
          any[]
        >`INSERT INTO leads (organization_id, name, phone, email, field_values) VALUES (${data.organizationId}, ${data.name}, ${data.phone}, ${data.email}, ${sql.json(data.fieldValues)}) RETURNING id, organization_id AS "organizationId", name, phone, email, field_values AS "fieldValues", created_at AS "createdAt", updated_at AS "updatedAt"`;
        return row!;
      },
      async update(args) {
        const where = (args as any).where.organizationId_id;
        const data = (args as any).data;
        const [row] = await sql<
          any[]
        >`UPDATE leads SET name=coalesce(${data.name ?? null}, name), phone=coalesce(${data.phone ?? null}, phone), email=coalesce(${data.email ?? null}, email), field_values=coalesce(${data.fieldValues === undefined ? null : sql.json(data.fieldValues)}, field_values), updated_at=now() WHERE organization_id=${where.organizationId} AND id=${where.id} RETURNING id, organization_id AS "organizationId", name, phone, email, field_values AS "fieldValues", created_at AS "createdAt", updated_at AS "updatedAt"`;
        return row!;
      },
    },
    processInstance: {
      async findUnique(args) {
        const where = (args as any).where.organizationId_id;
        const [row] = await loadProcesses(sql, where.organizationId, undefined, where.id);
        return row ?? null;
      },
      async findFirst(args) {
        const where = (args as any).where;
        const [row] = await loadProcesses(
          sql,
          where.organizationId,
          where.leadId,
          undefined,
          where.journeyId,
        );
        return row ?? null;
      },
      async create(args) {
        const d = (args as any).data;
        const [row] = await sql<
          any[]
        >`INSERT INTO process_instances (organization_id, lead_id, journey_id, current_status_id, is_primary) VALUES (${d.organizationId}, ${d.leadId}, ${d.journeyId}, ${d.currentStatusId}, ${d.isPrimary}) RETURNING id, organization_id AS "organizationId", lead_id AS "leadId", journey_id AS "journeyId", current_status_id AS "currentStatusId", is_primary AS "isPrimary", active`;
        return row!;
      },
      async update(args) {
        const where = (args as any).where.organizationId_id;
        const [row] = await sql<
          any[]
        >`UPDATE process_instances SET current_status_id=${(args as any).data.currentStatusId}, updated_at=now() WHERE organization_id=${where.organizationId} AND id=${where.id} RETURNING id, organization_id AS "organizationId", lead_id AS "leadId", journey_id AS "journeyId", current_status_id AS "currentStatusId", is_primary AS "isPrimary", active`;
        return row!;
      },
    },
    assignment: {
      async create(args) {
        const d = (args as any).data;
        const [row] = await sql<
          any[]
        >`INSERT INTO assignments (organization_id, process_instance_id, assignment_type, user_id) VALUES (${d.organizationId}, ${d.processInstanceId}, ${d.assignmentType}, ${d.userId}) RETURNING id, organization_id AS "organizationId", process_instance_id AS "processInstanceId", assignment_type AS "assignmentType", user_id AS "userId", is_current AS "isCurrent"`;
        return row!;
      },
    },
    user: {
      async findUnique(args) {
        const where = (args as any).where.organizationId_id;
        const [row] = await sql<
          { id: string }[]
        >`SELECT id FROM users WHERE organization_id=${where.organizationId} AND id=${where.id}`;
        return row ?? null;
      },
    },
    activityLog: {
      async create(args) {
        const d = (args as any).data;
        await sql`INSERT INTO activity_logs (organization_id, lead_id, process_instance_id, actor_user_id, action_type, source, old_value, new_value) VALUES (${d.organizationId}, ${d.leadId}, ${d.processInstanceId}, ${d.actorUserId}, ${d.actionType}, ${d.source}, ${d.oldValue === null ? null : sql.json(d.oldValue)}, ${d.newValue === null ? null : sql.json(d.newValue)})`;
      },
    },
  };
  return client;
}

async function loadProcesses(
  sql: postgres.Sql,
  organizationId: string,
  leadId?: string,
  id?: string,
  journeyId?: string,
) {
  const rows = await sql<
    any[]
  >`SELECT p.id, p.organization_id AS "organizationId", p.lead_id AS "leadId", p.journey_id AS "journeyId", p.current_status_id AS "currentStatusId", p.is_primary AS "isPrimary", p.active, jsonb_build_object('id', j.id, 'key', j.key, 'name', j.name) AS journey, jsonb_build_object('id', s.id, 'key', s.key, 'name', s.name) AS "currentStatus" FROM process_instances p JOIN journeys j ON j.id=p.journey_id JOIN statuses s ON s.id=p.current_status_id AND s.journey_id=p.journey_id WHERE p.organization_id=${organizationId} AND (${leadId ?? null}::uuid IS NULL OR p.lead_id=${leadId ?? null}) AND (${id ?? null}::uuid IS NULL OR p.id=${id ?? null}) AND (${journeyId ?? null}::uuid IS NULL OR p.journey_id=${journeyId ?? null}) ORDER BY p.created_at`;
  for (const row of rows)
    row.assignments = await sql<
      any[]
    >`SELECT id, organization_id AS "organizationId", process_instance_id AS "processInstanceId", assignment_type AS "assignmentType", user_id AS "userId", is_current AS "isCurrent" FROM assignments WHERE organization_id=${organizationId} AND process_instance_id=${row.id} AND is_current=true`;
  return rows;
}

async function permittedLeadIds(
  sql: postgres.Sql,
  where: any,
  skip: number,
  take: number,
): Promise<string[]> {
  const process = where.processInstances?.some ?? where.OR?.[0]?.processInstances?.some;
  const journeyIds: string[] = process.journeyId.in;
  // Optional now: no types supplied means no assignment-type filter.
  const assignmentTypes: string[] | undefined = process.assignments.some.assignmentType?.in;
  const rows = await sql<
    { id: string }[]
  >`SELECT DISTINCT l.id FROM leads l JOIN process_instances p ON p.lead_id=l.id JOIN assignments a ON a.process_instance_id=p.id WHERE l.organization_id=${where.organizationId} AND p.active=true AND p.journey_id IN ${sql(journeyIds)} AND a.is_current=true ${assignmentTypes ? sql`AND a.assignment_type IN ${sql(assignmentTypes)}` : sql``} ORDER BY l.id OFFSET ${skip} LIMIT ${take}`;
  return rows.map((row) => row.id);
}
