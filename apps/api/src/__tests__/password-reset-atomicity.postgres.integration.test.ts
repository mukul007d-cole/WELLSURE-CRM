import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';

import {
  createPostgresAuthRepository,
  createPostgresDatabase,
  getAuditRows,
  seedUser,
  setupAuthSchema,
  shouldRunPostgresIntegration,
} from './fixtures/synthetic-auth.js';
import { hashOpaqueToken } from '../auth/tokens.js';
import { hashPassword, verifyPassword } from '../auth/password.js';

/**
 * Regression coverage for finding #2's other half: a failure partway
 * through completion must not leave the password changed while the token
 * stays valid and replayable. Before the fix, `setUserPasswordHash`,
 * `markPasswordResetTokenUsed`, `revokeUserSessions` and the audit write
 * were four separate statements with no transaction — a failure after the
 * first left exactly that dangerous half-applied state. Now they are one
 * `$transaction` (Prisma) / `sql.begin` (raw), so a failure on the last
 * statement must roll back the first.
 *
 * This drives the failure through the real Postgres-backed repository by
 * making the audit insert violate a real constraint (a bad organization_id
 * with no matching row would violate nothing here since these are plain
 * temp tables with no FK — so instead this uses a duplicate-token-hash
 * unique violation forced via a second, pre-existing row) — no mocking of
 * the transaction mechanism itself, so this proves real Postgres rollback,
 * not application-level bookkeeping.
 */
describe.runIf(shouldRunPostgresIntegration)(
  'password reset: transactional rollback on failure',
  () => {
    let db: Awaited<ReturnType<typeof createPostgresDatabase>>;
    let sql: postgres.Sql;

    const org = randomUUID();

    beforeAll(async () => {
      db = await createPostgresDatabase();
      sql = db.sql;
      await setupAuthSchema(sql);
    });

    afterAll(async () => {
      await db?.cleanup();
    });

    it('rolls back the password change when the transaction fails before commit', async () => {
      const repository = createPostgresAuthRepository(sql);
      const userId = await seedUser(sql, {
        organizationId: org,
        email: 'atomic@example.test',
        passwordHash: await hashPassword('Original-Passw0rd!'),
      });

      const rawToken = 'regression-atomicity-token';
      const tokenHash = hashOpaqueToken(rawToken);
      const now = new Date();
      await sql`
      INSERT INTO auth_test_password_reset_tokens
        (organization_id, user_id, token_hash, created_at, expires_at, used_at)
      VALUES (${org}, ${userId}, ${tokenHash}, ${now}, ${new Date(now.getTime() + 30 * 60 * 1000)}, null)
    `;

      // Force the transaction to fail on its very last statement (the audit
      // write) by making the connection's session unable to complete it: we
      // drop a column the insert needs, inside the same schema, so the write
      // fails with a real Postgres error and the whole transaction — issued
      // as one `sql.begin` block — aborts and rolls back everything already
      // executed on that connection, exactly like a genuine mid-transaction
      // fault would.
      await sql`ALTER TABLE auth_test_system_audit_logs DROP COLUMN new_value`;

      await expect(
        repository.completePasswordResetTransaction({
          tokenHash,
          newPasswordHash: await hashPassword('Should-Never-Stick!'),
          now,
        }),
      ).rejects.toThrow();

      // The password write inside the same transaction must have rolled
      // back too — not just the audit row.
      const finalUser = await sql<{ password_hash: string }[]>`
      SELECT password_hash FROM auth_test_users WHERE id = ${userId}
    `;
      expect(await verifyPassword('Original-Passw0rd!', finalUser[0]!.password_hash)).toBe(true);
      expect(await verifyPassword('Should-Never-Stick!', finalUser[0]!.password_hash)).toBe(false);

      // The token must still be unused — not silently consumed — so the
      // legitimate user can retry the reset once the underlying fault clears.
      const tokenRow = await sql<{ used_at: Date | null }[]>`
      SELECT used_at FROM auth_test_password_reset_tokens WHERE token_hash = ${tokenHash}
    `;
      expect(tokenRow[0]?.used_at).toBeNull();

      // Restore the column ("the underlying fault clears") before checking
      // for an orphaned "it happened" audit trail for a change that didn't.
      await sql`ALTER TABLE auth_test_system_audit_logs ADD COLUMN new_value jsonb`;
      const auditRows = await getAuditRows(sql, org);
      expect(
        auditRows.filter((row) => row.action === 'auth.password_reset_completed'),
      ).toHaveLength(0);
    });
  },
);
