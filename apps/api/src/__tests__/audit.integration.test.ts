import { afterAll, describe, expect, it } from 'vitest';

import { defaultAuthConfig } from '../auth/config.js';
import { login } from '../auth/login.js';
import {
  createPostgresAuthRepository,
  createPostgresDatabase,
  getAuditRows,
  setupAuthSchema,
  shouldRunPostgresIntegration,
} from './fixtures/synthetic-auth.js';

let cleanup: (() => Promise<void>) | undefined;
afterAll(async () => {
  await cleanup?.();
});

describe.runIf(shouldRunPostgresIntegration)('security audit trail against real Postgres', () => {
  it('writes a valid audit row for a failed login on an unknown email', async () => {
    const database = await createPostgresDatabase();
    cleanup = database.cleanup;
    await setupAuthSchema(database.sql);
    const repository = createPostgresAuthRepository(database.sql);
    const orgId = '33333333-3333-3333-3333-333333333333';

    // Regression test for the entity_id-must-be-a-uuid bug: this used to
    // throw because the email was passed as entity_id into a uuid column.
    const result = await login({
      repository,
      audit: repository,
      config: defaultAuthConfig,
      organizationId: orgId,
      email: 'nobody@example.test',
      password: 'irrelevant',
    });
    expect(result.ok).toBe(false);

    const rows = await getAuditRows(database.sql, orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('auth.login_failed');
    expect(rows[0]?.entityType).toBe('login_attempt');
    // entityId must be a real uuid the insert above already proved this,
    // but assert the shape too.
    expect(rows[0]?.entityId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('writes a lockout audit row after the configured attempt threshold', async () => {
    const database = await createPostgresDatabase();
    cleanup = database.cleanup;
    await setupAuthSchema(database.sql);
    const repository = createPostgresAuthRepository(database.sql);
    const orgId = '44444444-4444-4444-4444-444444444444';

    for (let i = 0; i < defaultAuthConfig.lockoutMaxAttempts; i += 1) {
      await login({
        repository,
        audit: repository,
        config: defaultAuthConfig,
        organizationId: orgId,
        email: 'locked@example.test',
        password: 'wrong',
      });
    }

    const rows = await getAuditRows(database.sql, orgId);
    expect(rows.some((row) => row.action === 'auth.lockout_created')).toBe(true);
  });
});

describe.skipIf(shouldRunPostgresIntegration)('security audit trail against real Postgres', () => {
  it('requires Docker/Testcontainers or FALCON_POSTGRES_URL to execute', () => {
    expect(shouldRunPostgresIntegration).toBe(false);
  });
});
