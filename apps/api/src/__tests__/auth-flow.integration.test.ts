import { afterAll, describe, expect, it } from 'vitest';

import { defaultAuthConfig } from '../auth/config.js';
import { login } from '../auth/login.js';
import { hashPassword } from '../auth/password.js';
import { revokeSession, validateSession } from '../auth/session.js';
import {
  createPostgresAuthRepository,
  createPostgresDatabase,
  seedUser,
  setupAuthSchema,
  shouldRunPostgresIntegration,
} from './fixtures/synthetic-auth.js';

let cleanup: (() => Promise<void>) | undefined;
afterAll(async () => {
  await cleanup?.();
});

describe.runIf(shouldRunPostgresIntegration)('auth flow against real Postgres', () => {
  it('logs in, validates the session, then rejects it after logout', async () => {
    const database = await createPostgresDatabase();
    cleanup = database.cleanup;
    await setupAuthSchema(database.sql);
    const repository = createPostgresAuthRepository(database.sql);
    const orgId = '11111111-1111-1111-1111-111111111111';
    const email = 'owner@example.test';
    const passwordHash = await hashPassword('correct horse battery staple');
    await seedUser(database.sql, { organizationId: orgId, email, passwordHash });

    const result = await login({
      repository,
      audit: repository,
      config: defaultAuthConfig,
      organizationId: orgId,
      email,
      password: 'correct horse battery staple',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const validated = await validateSession({ repository, token: result.session.token });
    expect(validated?.user.organizationId).toBe(orgId);

    const revoked = await revokeSession({
      repository,
      audit: repository,
      sessionId: result.session.record.id,
      organizationId: orgId,
      actorUserId: validated?.user.id ?? null,
    });
    expect(revoked).toBe(true);

    const afterLogout = await validateSession({ repository, token: result.session.token });
    expect(afterLogout).toBeNull();
  });

  it('rejects a session belonging to a different organization', async () => {
    const database = await createPostgresDatabase();
    cleanup = database.cleanup;
    await setupAuthSchema(database.sql);
    const repository = createPostgresAuthRepository(database.sql);
    const orgA = '11111111-1111-1111-1111-111111111111';
    const orgB = '22222222-2222-2222-2222-222222222222';
    const passwordHash = await hashPassword('org-a-password');
    const userId = await seedUser(database.sql, {
      organizationId: orgA,
      email: 'a@example.test',
      passwordHash,
    });

    const result = await login({
      repository,
      audit: repository,
      config: defaultAuthConfig,
      organizationId: orgA,
      email: 'a@example.test',
      password: 'org-a-password',
    });
    expect(result.ok).toBe(true);

    // Tenant isolation at the query level: fetching this user under a
    // different organization id must return nothing, even with a valid id.
    const crossOrgSnapshot = await repository.getUserSnapshot(userId, orgB);
    expect(crossOrgSnapshot).toBeNull();
  });
});

describe.skipIf(shouldRunPostgresIntegration)('auth flow against real Postgres', () => {
  it('requires Docker/Testcontainers or FALCON_POSTGRES_URL to execute', () => {
    expect(shouldRunPostgresIntegration).toBe(false);
  });
});
