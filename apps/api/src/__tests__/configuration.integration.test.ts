import { readFile } from 'node:fs/promises';

import { afterAll, describe, expect, it } from 'vitest';

import { createPostgresDatabase, shouldRunPostgresIntegration } from './fixtures/synthetic-auth.js';

let cleanup: (() => Promise<void>) | undefined;
afterAll(async () => {
  await cleanup?.();
});

describe.runIf(shouldRunPostgresIntegration)('configuration safety against real Postgres', () => {
  it('uses the database trigger to block active Status deactivation, then permits reassignment with both logs', async () => {
    const database = await createPostgresDatabase();
    cleanup = database.cleanup;
    const migration = await readFile(
      new URL(
        '../../../../packages/database/prisma/migrations/00000000000000_initial/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await database.sql.unsafe(migration);

    const orgId = '11111111-1111-1111-1111-111111111111';
    const roleId = '22222222-2222-2222-2222-222222222222';
    const actorId = '33333333-3333-3333-3333-333333333333';
    const journeyId = '44444444-4444-4444-4444-444444444444';
    const statusA = '55555555-5555-5555-5555-555555555555';
    const statusB = '66666666-6666-6666-6666-666666666666';
    const leadId = '77777777-7777-7777-7777-777777777777';
    const processId = '88888888-8888-8888-8888-888888888888';

    await database.sql`INSERT INTO organizations (id, name) VALUES (${orgId}, 'Test Organization')`;
    await database.sql`INSERT INTO roles (id, organization_id, key, name) VALUES (${roleId}, ${orgId}, 'test_role', 'Test Role')`;
    await database.sql`INSERT INTO users (id, organization_id, name, email, role_id) VALUES (${actorId}, ${orgId}, 'Test Actor', 'actor@example.test', ${roleId})`;
    await database.sql`INSERT INTO journeys (id, organization_id, key, name, created_by, updated_by) VALUES (${journeyId}, ${orgId}, 'test_journey_a', 'Test Journey A', ${actorId}, ${actorId})`;
    await database.sql`INSERT INTO statuses (id, organization_id, journey_id, key, name, outcome_type, behavior_type, sort_order, created_by, updated_by) VALUES (${statusA}, ${orgId}, ${journeyId}, 'test_status_a', 'Test Status A', 'open', 'default', 1, ${actorId}, ${actorId}), (${statusB}, ${orgId}, ${journeyId}, 'test_status_b', 'Test Status B', 'open', 'default', 2, ${actorId}, ${actorId})`;
    await database.sql`INSERT INTO leads (id, organization_id, name) VALUES (${leadId}, ${orgId}, 'Test Lead A')`;
    await database.sql`INSERT INTO process_instances (id, organization_id, lead_id, journey_id, current_status_id, active) VALUES (${processId}, ${orgId}, ${leadId}, ${journeyId}, ${statusA}, true)`;

    await expect(
      database.sql`UPDATE statuses SET active = false WHERE organization_id = ${orgId} AND id = ${statusA}`,
    ).rejects.toThrow(/status has active process instances/);

    await database.sql.begin(async (sql) => {
      await sql`UPDATE process_instances SET current_status_id = ${statusB} WHERE organization_id = ${orgId} AND id = ${processId}`;
      await sql`INSERT INTO activity_logs (organization_id, lead_id, process_instance_id, actor_user_id, action_type, source, old_value, new_value) VALUES (${orgId}, ${leadId}, ${processId}, ${actorId}, 'status_change', 'configuration_engine', ${sql.json({ statusId: statusA })}, ${sql.json({ statusId: statusB })})`;
      await sql`UPDATE statuses SET active = false, updated_by = ${actorId} WHERE organization_id = ${orgId} AND id = ${statusA}`;
      await sql`INSERT INTO system_audit_logs (organization_id, actor_user_id, entity_type, entity_id, action, old_value, new_value) VALUES (${orgId}, ${actorId}, 'status', ${statusA}, 'reassign_and_deactivate', ${sql.json({ statusId: statusA })}, ${sql.json({ statusId: statusA, reassignedProcessInstances: 1 })})`;
    });

    const [status] = await database.sql<
      { active: boolean }[]
    >`SELECT active FROM statuses WHERE id = ${statusA}`;
    const [activity] = await database.sql<
      { count: string }[]
    >`SELECT count(*) FROM activity_logs WHERE action_type = 'status_change'`;
    const [audit] = await database.sql<
      { count: string }[]
    >`SELECT count(*) FROM system_audit_logs WHERE action = 'reassign_and_deactivate'`;
    expect(status?.active).toBe(false);
    expect(activity?.count).toBe('1');
    expect(audit?.count).toBe('1');
  });
});

describe.skipIf(shouldRunPostgresIntegration)('configuration safety against real Postgres', () => {
  it('requires Docker/Testcontainers or FALCON_POSTGRES_URL to execute', () => {
    expect(shouldRunPostgresIntegration).toBe(false);
  });
});
