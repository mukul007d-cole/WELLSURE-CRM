import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';
import type { RecordPredicate } from '@falcon/permission-engine';

import { PrismaLeadRepository, sellerWhere } from '../leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import { buildSellerListQuery } from '../leads/filter-sql.js';
import { parseFilter, resolveFilter } from '../leads/filter-validation.js';
import { listSellers } from '../routes/leads.js';
import { createAdminPostgres, shouldRunAdminPostgres } from './fixtures/synthetic-admin.js';

/**
 * Phase 13b — the Seller List filter engine against real Postgres.
 *
 * Three things here are load-bearing and would otherwise regress silently:
 * a filter on a Field the caller cannot see is rejected rather than dropped;
 * filters never widen data scope; and equality on a custom Field still reaches
 * `leads_field_values_gin_idx`, asserted by reading the query plan rather than
 * trusting that the index exists.
 */

describe.runIf(shouldRunAdminPostgres)('Phase 13b Seller List filter engine', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;
  let repository: PrismaLeadRepository;

  const org = randomUUID();
  const roleAll = randomUUID();
  const roleLimited = randomUUID();
  const userAll = randomUUID();
  const userLimited = randomUUID();
  const userOther = randomUUID();
  const journey = randomUUID();
  const otherJourney = randomUUID();
  const status = randomUUID();
  const otherStatus = randomUUID();
  const openField = randomUUID();
  const secretField = randomUUID();
  const numberField = randomUUID();
  const dateField = randomUUID();
  const selectField = randomUUID();
  const boolField = randomUUID();
  const assignmentType = 'synthetic_owner';

  /** name -> lead id, so assertions read as names rather than uuids. */
  const leadIds = new Map<string, string>();

  const auth = (userId: string) => ({
    user: {
      id: userId,
      organizationId: org,
      roleId: userId === userLimited ? roleLimited : roleAll,
      active: true,
      departmentId: null,
      managerId: null,
    },
    session: {} as never,
  });

  const permissionRepository = () => new PrismaPermissionRepository(prisma as never);

  const list = async (userId: string, query: Record<string, unknown> = {}) =>
    listSellers({
      auth: auth(userId),
      sellerRepository: repository,
      permissionRepository: permissionRepository(),
      list: {
        requestedFieldIds: [openField, secretField, numberField, dateField, selectField, boolField],
        assignmentTypes: [assignmentType],
        pageSize: 100,
        ...query,
      },
    });

  const namesFrom = (body: unknown) =>
    ((body as { rows: Array<{ name: string }> }).rows ?? []).map((row) => row.name).sort();

  const filterOn = (target: unknown, operator: string, values: unknown[] = []) =>
    JSON.stringify({ conditions: [{ target, operator, values }] });

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    for (const file of [
      '00000000000000_initial',
      '00000000000001_custom_session_auth',
      '00000000000002_lead_sharing_notifications',
      '00000000000003_attachment_metadata',
    ])
      await db.sql.unsafe(
        await readFile(
          new URL(
            `../../../../packages/database/prisma/migrations/${file}/migration.sql`,
            import.meta.url,
          ),
          'utf8',
        ),
      );
    repository = new PrismaLeadRepository(prisma as never);

    await prisma.organization.create({ data: { id: org, name: 'Synthetic organization' } });
    await prisma.role.createMany({
      data: [
        { id: roleAll, organizationId: org, key: 'synthetic_all', name: 'Synthetic all' },
        {
          id: roleLimited,
          organizationId: org,
          key: 'synthetic_limited',
          name: 'Synthetic limited',
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: userAll,
          organizationId: org,
          name: 'Synthetic wide user',
          email: 'wide@example.test',
          roleId: roleAll,
        },
        {
          id: userLimited,
          organizationId: org,
          name: 'Synthetic limited user',
          email: 'limited@example.test',
          roleId: roleLimited,
        },
        {
          id: userOther,
          organizationId: org,
          name: 'Synthetic other user',
          email: 'other@example.test',
          roleId: roleAll,
        },
      ],
    });
    await prisma.rolePermission.createMany({
      data: [
        {
          organizationId: org,
          roleId: roleAll,
          module: 'leads',
          action: 'view',
          scope: 'ORGANIZATION',
        },
        // The limited role sees only its own records: the scope containment
        // case below depends on it.
        {
          organizationId: org,
          roleId: roleLimited,
          module: 'leads',
          action: 'view',
          scope: 'SELF',
        },
      ],
    });
    await prisma.journey.createMany({
      data: [
        { id: journey, organizationId: org, key: 'synthetic_journey', name: 'Synthetic journey' },
        { id: otherJourney, organizationId: org, key: 'synthetic_other', name: 'Synthetic other' },
      ],
    });
    await prisma.roleJourneyAccess.createMany({
      data: [roleAll, roleLimited].flatMap((roleId) =>
        [journey, otherJourney].map((journeyId) => ({ organizationId: org, roleId, journeyId })),
      ),
    });
    await prisma.status.createMany({
      data: [
        {
          id: status,
          organizationId: org,
          journeyId: journey,
          key: 'synthetic_status',
          name: 'Synthetic status',
          outcomeType: 'open',
          behaviorType: 'default',
          sortOrder: 0,
        },
        {
          id: otherStatus,
          organizationId: org,
          journeyId: journey,
          key: 'synthetic_status_two',
          name: 'Synthetic status two',
          outcomeType: 'open',
          behaviorType: 'default',
          sortOrder: 1,
        },
      ],
    });
    await prisma.field.createMany({
      data: [
        { id: openField, fieldType: 'text', key: 'synthetic_open' },
        { id: secretField, fieldType: 'text', key: 'synthetic_secret' },
        { id: numberField, fieldType: 'number', key: 'synthetic_number' },
        { id: dateField, fieldType: 'date', key: 'synthetic_date' },
        { id: selectField, fieldType: 'select', key: 'synthetic_select' },
        { id: boolField, fieldType: 'boolean', key: 'synthetic_bool' },
      ].map((field) => ({
        id: field.id,
        organizationId: org,
        key: field.key,
        name: field.key,
        fieldType: field.fieldType,
        editMode: 'manual',
        source: 'manual',
      })),
    });
    // Both roles see the open Field; only the wide role sees the secret one.
    await prisma.fieldVisibility.createMany({
      data: [
        ...[openField, numberField, dateField, selectField, boolField].flatMap((fieldId) =>
          [roleAll, roleLimited].map((roleId) => ({
            organizationId: org,
            roleId,
            fieldId,
            accessLevel: 'VIEW' as const,
          })),
        ),
        {
          organizationId: org,
          roleId: roleAll,
          fieldId: secretField,
          accessLevel: 'VIEW' as const,
        },
      ],
    });

    const seed = [
      {
        name: 'Alpha Seller',
        owner: userLimited,
        statusId: status,
        values: {
          [openField]: 'alpha value',
          [secretField]: 'restricted-alpha',
          [numberField]: 100,
          [dateField]: '2026-01-10',
          [selectField]: 'gold',
          [boolField]: true,
        },
      },
      {
        name: 'Beta Seller',
        owner: userOther,
        statusId: otherStatus,
        values: {
          [openField]: 'beta value',
          [secretField]: 'restricted-beta',
          [numberField]: 500,
          [dateField]: '2026-03-20',
          [selectField]: 'silver',
          [boolField]: false,
        },
      },
      {
        name: 'Gamma Seller',
        owner: userOther,
        statusId: status,
        values: { [openField]: '', [numberField]: 900, [selectField]: 'gold' },
      },
    ];
    for (const row of seed) {
      const lead = await prisma.lead.create({
        data: { organizationId: org, name: row.name, fieldValues: row.values },
      });
      leadIds.set(row.name, lead.id);
      const process = await prisma.processInstance.create({
        data: {
          organizationId: org,
          leadId: lead.id,
          journeyId: journey,
          currentStatusId: row.statusId,
          isPrimary: true,
        },
      });
      await prisma.assignment.create({
        data: {
          organizationId: org,
          processInstanceId: process.id,
          assignmentType,
          userId: row.owner,
        },
      });
    }
  }, 180_000);

  afterAll(async () => db?.cleanup());

  it('rejects a filter on a Field the caller cannot see, rather than dropping it', async () => {
    // The wide role can filter on the secret Field and finds exactly one lead.
    const allowed = await list(userAll, {
      filter: filterOn({ kind: 'field', fieldId: secretField }, 'equals', ['restricted-alpha']),
    });
    expect(allowed.status).toBe(200);
    expect(namesFrom(allowed.body)).toEqual(['Alpha Seller']);

    const denied = await list(userLimited, {
      filter: filterOn({ kind: 'field', fieldId: secretField }, 'equals', ['restricted-alpha']),
    });
    expect(denied.status).toBe(403);
    const serialized = JSON.stringify(denied.body);
    // Neither the denied Field's id nor any value may leak through the error.
    expect(serialized).not.toContain(secretField);
    expect(serialized).not.toContain('restricted-alpha');
    expect(serialized).not.toContain('Alpha Seller');

    /*
     * The two failure modes a silent implementation would produce, ruled out
     * explicitly: dropping the condition returns the caller's whole scope, and
     * treating it as false returns nothing. A 403 is neither.
     */
    const unfiltered = await list(userLimited);
    expect(unfiltered.status).toBe(200);
    expect(namesFrom(unfiltered.body)).toEqual(['Alpha Seller']);
    expect(denied.body).not.toEqual(unfiltered.body);
    expect((denied.body as { rows?: unknown[] }).rows).toBeUndefined();
  });

  it('filters on top of data scope and never widens it', async () => {
    // Beta belongs to another user; the SELF-scoped role cannot reach it even
    // when the filter matches it exactly.
    const scoped = await list(userLimited, {
      filter: filterOn({ kind: 'field', fieldId: openField }, 'equals', ['beta value']),
    });
    expect(scoped.status).toBe(200);
    expect(namesFrom(scoped.body)).toEqual([]);

    const wide = await list(userAll, {
      filter: filterOn({ kind: 'field', fieldId: openField }, 'equals', ['beta value']),
    });
    expect(namesFrom(wide.body)).toEqual(['Beta Seller']);
  });

  it('evaluates every operator against its configured field type', async () => {
    const cases: Array<[string, string, unknown[], string[]]> = [
      [openField, 'equals', ['alpha value'], ['Alpha Seller']],
      [openField, 'contains', ['value'], ['Alpha Seller', 'Beta Seller']],
      [openField, 'starts_with', ['beta'], ['Beta Seller']],
      [openField, 'is_not_empty', [], ['Alpha Seller', 'Beta Seller']],
      [openField, 'is_empty', [], ['Gamma Seller']],
      [numberField, 'equals', [500], ['Beta Seller']],
      [numberField, 'greater_than', [400], ['Beta Seller', 'Gamma Seller']],
      [numberField, 'less_than', [400], ['Alpha Seller']],
      [numberField, 'between', [100, 500], ['Alpha Seller', 'Beta Seller']],
      [dateField, 'before', ['2026-02-01'], ['Alpha Seller']],
      [dateField, 'after', ['2026-02-01'], ['Beta Seller']],
      [dateField, 'between', ['2026-01-01', '2026-12-31'], ['Alpha Seller', 'Beta Seller']],
      [dateField, 'is_empty', [], ['Gamma Seller']],
      [selectField, 'in', ['gold'], ['Alpha Seller', 'Gamma Seller']],
      [selectField, 'not_in', ['gold'], ['Beta Seller']],
      [boolField, 'is_true', [], ['Alpha Seller']],
      [boolField, 'is_false', [], ['Beta Seller']],
    ];
    for (const [fieldId, operator, values, expected] of cases) {
      const response = await list(userAll, {
        filter: filterOn({ kind: 'field', fieldId }, operator, values),
      });
      expect(response.status, operator).toBe(200);
      expect(namesFrom(response.body), `${operator} on ${fieldId}`).toEqual(expected);
    }
  });

  it('filters core columns, including status and journey by id', async () => {
    const cases: Array<[string, string, unknown[], string[]]> = [
      ['name', 'contains', ['Alpha'], ['Alpha Seller']],
      ['name', 'starts_with', ['Beta'], ['Beta Seller']],
      ['email', 'is_empty', [], ['Alpha Seller', 'Beta Seller', 'Gamma Seller']],
      ['status', 'in', [status], ['Alpha Seller', 'Gamma Seller']],
      ['status', 'not_in', [status], ['Beta Seller']],
      ['journey', 'in', [journey], ['Alpha Seller', 'Beta Seller', 'Gamma Seller']],
      ['journey', 'in', [otherJourney], []],
    ];
    for (const [column, operator, values, expected] of cases) {
      const response = await list(userAll, {
        filter: filterOn({ kind: 'core', column }, operator, values),
      });
      expect(response.status, `${column} ${operator}`).toBe(200);
      expect(namesFrom(response.body), `${column} ${operator}`).toEqual(expected);
    }
  });

  it('combines conditions with AND', async () => {
    const filter = JSON.stringify({
      conditions: [
        { target: { kind: 'field', fieldId: selectField }, operator: 'in', values: ['gold'] },
        {
          target: { kind: 'field', fieldId: numberField },
          operator: 'greater_than',
          values: [500],
        },
      ],
    });
    const response = await list(userAll, { filter });
    expect(namesFrom(response.body)).toEqual(['Gamma Seller']);
  });

  it('keeps the count in step with the rows it filtered', async () => {
    const response = await list(userAll, {
      pageSize: 1,
      filter: filterOn({ kind: 'field', fieldId: selectField }, 'in', ['gold']),
    });
    const body = response.body as { total: number; rows: unknown[] };
    // Count parity is the rule in docs/permissions/access-model.md: a count
    // that ignored the filter would leak how many records exist beyond it.
    expect(body.total).toBe(2);
    expect(body.rows).toHaveLength(1);
  });

  it('rejects a malformed filter without touching the database', async () => {
    for (const filter of [
      '{not json',
      filterOn({ kind: 'core', column: 'password_hash' }, 'equals', ['x']),
      filterOn({ kind: 'field', fieldId: selectField }, 'greater_than', [1]),
      filterOn({ kind: 'field', fieldId: dateField }, 'before', ['01/02/2026']),
    ]) {
      const response = await list(userAll, { filter });
      expect(response.status, filter).toBe(400);
    }
  });

  it('answers an unknown Field id the same way as a denied one', async () => {
    // 403 rather than 404/400: distinguishing "no such Field" from "not yours"
    // would turn the filter into a probe for which Field ids exist.
    const response = await list(userAll, {
      filter: filterOn({ kind: 'field', fieldId: randomUUID() }, 'equals', ['x']),
    });
    expect(response.status).toBe(403);
  });

  it('matches the Prisma predicate it replaced, across every scope and access mode', async () => {
    /*
     * Leaving Prisma's query builder means data scope is expressed twice. This
     * is the guard: the compiled SQL and the retained Prisma predicate must
     * select the same leads for every scope shape, or one of them is wrong.
     */
    const shapes: Array<{ label: string; predicate: RecordPredicate }> = [
      {
        label: 'organization',
        predicate: {
          organizationId: org,
          scope: 'ORGANIZATION',
          allowedUserIds: 'ALL_ORGANIZATION_USERS',
          assignmentTypes: [assignmentType],
          journeyIds: [journey, otherJourney],
          includeDirectGrantsForUserId: userAll,
          directGrantAction: 'view',
        },
      },
      {
        label: 'self',
        predicate: {
          organizationId: org,
          scope: 'SELF',
          allowedUserIds: [userLimited],
          assignmentTypes: [assignmentType],
          journeyIds: [journey, otherJourney],
          includeDirectGrantsForUserId: userLimited,
          directGrantAction: 'view',
        },
      },
      {
        label: 'team',
        predicate: {
          organizationId: org,
          scope: 'TEAM',
          allowedUserIds: [userLimited, userOther],
          assignmentTypes: [assignmentType],
          journeyIds: [journey],
          includeDirectGrantsForUserId: userLimited,
          directGrantAction: 'view',
        },
      },
      {
        label: 'no assignment types named',
        predicate: {
          organizationId: org,
          scope: 'DEPARTMENT',
          allowedUserIds: [userOther],
          assignmentTypes: [],
          journeyIds: [journey],
          includeDirectGrantsForUserId: userOther,
          directGrantAction: 'view',
        },
      },
    ];
    for (const shape of shapes) {
      for (const accessMode of ['mine', 'shared_with_me', 'all'] as const) {
        const input = {
          organizationId: org,
          recordPredicate: shape.predicate,
          requestedFieldIds: [],
          assignmentTypes: [assignmentType],
          accessMode,
          page: 1,
          pageSize: 100,
        };
        const query = buildSellerListQuery({
          organizationId: org,
          predicate: shape.predicate,
          conditions: [],
          accessMode,
          page: 1,
          pageSize: 100,
        });
        const rawRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          query.ids.text,
          ...query.ids.values,
        );
        const prismaRows = await prisma.lead.findMany({
          where: sellerWhere(input) as never,
          select: { id: true },
        });
        expect(rawRows.map((row) => row.id).sort(), `${shape.label} / ${accessMode}`).toEqual(
          prismaRows.map((row) => row.id).sort(),
        );
      }
    }
  });

  it('still reaches the GIN index for an equality filter', async () => {
    /*
     * The plan for this phase measured containment at 1.1ms against 116.5ms for
     * the expression form Prisma emits. Asserting the plan by name is what
     * stops a refactor from quietly reverting to the slow one — the index
     * existing is not the same as the planner choosing it.
     */
    /*
     * Bulk rows so the planner has a real choice: on three leads a sequential
     * scan is genuinely cheaper, and the assertion would prove nothing. One
     * row carries the needle, so the filter is selective the way a real one is.
     */
    await prisma.$executeRawUnsafe(
      `INSERT INTO leads (organization_id, name, field_values)
       SELECT $1::uuid, 'Bulk Seller ' || g, jsonb_build_object($2::text, 'bulk value ' || (g % 500))
       FROM generate_series(1, 3000) g`,
      org,
      openField,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO leads (organization_id, name, field_values)
       VALUES ($1::uuid, 'Needle Seller', jsonb_build_object($2::text, 'needle value'))`,
      org,
      openField,
    );
    await prisma.$executeRawUnsafe('ANALYZE leads');

    const conditions = resolveFilter({
      filter: parseFilter(
        filterOn({ kind: 'field', fieldId: openField }, 'equals', ['needle value']),
      ),
      fieldTypes: await repository.listFilterableFieldTypes(org),
    });
    const query = buildSellerListQuery({
      organizationId: org,
      predicate: {
        organizationId: org,
        scope: 'ORGANIZATION',
        allowedUserIds: 'ALL_ORGANIZATION_USERS',
        assignmentTypes: [assignmentType],
        journeyIds: [journey],
        includeDirectGrantsForUserId: userAll,
        directGrantAction: 'view',
      },
      conditions,
      page: 1,
      pageSize: 25,
    });
    const plan = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
      `EXPLAIN ${query.count.text}`,
      ...query.count.values,
    );
    const text = plan.map((row) => Object.values(row).join(' ')).join('\n');
    expect(text).toContain('leads_field_values_gin_idx');
    expect(text).toContain('field_values @>');
  });
});
