import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';

import { completePasswordReset } from '../auth/password-reset.js';
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
 * Regression coverage for the password-reset race: two concurrent
 * completions of the SAME token, against real Postgres, using a
 * deterministic barrier so both are guaranteed to reach the token check
 * before either can claim it — this is not a timing-dependent flake test.
 *
 * Before the fix (separate findPasswordResetToken / setUserPasswordHash /
 * markPasswordResetTokenUsed calls, no transaction): both requests
 * observed `ok: true`, and the loser's password change was silently
 * discarded by the winner's later write. See the investigation notes on
 * finding #2.
 */
describe.runIf(shouldRunPostgresIntegration)(
  'password reset: concurrent completion of one token',
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

    it('lets exactly one of two concurrent completions succeed, and never loses which password won', async () => {
      const baseRepository = createPostgresAuthRepository(sql);
      const userId = await seedUser(sql, {
        organizationId: org,
        email: 'race@example.test',
        passwordHash: await hashPassword('Original-Passw0rd!'),
      });

      const rawToken = 'regression-race-token';
      const tokenHash = hashOpaqueToken(rawToken);
      const now = new Date();
      await sql`
      INSERT INTO auth_test_password_reset_tokens
        (organization_id, user_id, token_hash, created_at, expires_at, used_at)
      VALUES (${org}, ${userId}, ${tokenHash}, ${now}, ${new Date(now.getTime() + 30 * 60 * 1000)}, null)
    `;

      // Deterministic barrier: both concurrent calls must reach the claim
      // step before either is allowed to proceed, so the race reproduces
      // every run rather than depending on scheduler luck.
      let arrivals = 0;
      let releaseBarrier: () => void;
      const barrier = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      const repository = {
        ...baseRepository,
        async completePasswordResetTransaction(
          input: Parameters<typeof baseRepository.completePasswordResetTransaction>[0],
        ) {
          arrivals += 1;
          if (arrivals >= 2) releaseBarrier();
          await barrier;
          return baseRepository.completePasswordResetTransaction(input);
        },
      };

      const [resultA, resultB] = await Promise.all([
        completePasswordReset({ repository, token: rawToken, newPassword: 'Attacker-NewPass1!' }),
        completePasswordReset({ repository, token: rawToken, newPassword: 'Legitimate-NewPass2!' }),
      ]);

      // Exactly one request is told it succeeded; the other is told the
      // token is invalid — never both `ok: true`.
      const outcomes = [resultA, resultB];
      expect(outcomes.filter((r) => r.ok).length).toBe(1);
      expect(outcomes.filter((r) => !r.ok).length).toBe(1);
      const loser = outcomes.find((r) => !r.ok) as { ok: false; reason: string };
      expect(loser.reason).toBe('invalid_token');

      const finalUser = await sql<{ password_hash: string }[]>`
      SELECT password_hash FROM auth_test_users WHERE id = ${userId}
    `;
      const finalHash = finalUser[0]!.password_hash;
      const matchesA = await verifyPassword('Attacker-NewPass1!', finalHash);
      const matchesB = await verifyPassword('Legitimate-NewPass2!', finalHash);
      // The password that survives is exactly the one the winning request
      // asked for — never a silently-discarded loser and never both/neither.
      expect([matchesA, matchesB].filter(Boolean)).toHaveLength(1);
      expect(matchesA).toBe(resultA.ok);
      expect(matchesB).toBe(resultB.ok);

      const tokenRow = await sql<{ used_at: Date | null }[]>`
      SELECT used_at FROM auth_test_password_reset_tokens WHERE token_hash = ${tokenHash}
    `;
      expect(tokenRow[0]?.used_at).not.toBeNull();

      // Exactly one completion audit row — not two, and not zero.
      const auditRows = await getAuditRows(sql, org);
      expect(
        auditRows.filter((row) => row.action === 'auth.password_reset_completed'),
      ).toHaveLength(1);
    });
  },
);
