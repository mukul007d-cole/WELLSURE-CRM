import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { createPrismaClient, type FalconPrismaClient } from '@falcon/database';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';

export const shouldRunAdminPostgres =
  process.env.FALCON_POSTGRES_URL !== undefined ||
  process.env.DOCKER_HOST !== undefined ||
  existsSync('/var/run/docker.sock');

/**
 * Applies every checked-in migration, in order — the whole schema.
 *
 * Phase 17 squashed nine migrations into one baseline. Before that, each
 * Postgres test restated the prefix of the history its phase happened to need,
 * which is why ten test files carried ten slightly different hardcoded lists,
 * all of which the squash invalidated at once. Reading the directory is what
 * stops that recurring: a test asks for the schema, not for a list of files it
 * has to keep in step with `prisma/migrations/`.
 *
 * Held under an advisory lock because `CREATE EXTENSION IF NOT EXISTS` is not
 * atomic: two suites racing it against one database both find the extension
 * missing and both try to create it, and the loser fails on
 * `pg_extension_name_index`. `prisma migrate deploy` never hits this — it takes
 * its own lock — but these suites apply the SQL directly and vitest runs their
 * files in parallel. The lock is transaction-scoped, so it cannot outlive the
 * work even if a suite throws part-way through.
 */
export async function applyMigrations(sql: Sql): Promise<void> {
  const directory = new URL('../../../../../packages/database/prisma/migrations/', import.meta.url);
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const files = await Promise.all(
    names.map((name) => readFile(new URL(`${name}/migration.sql`, directory), 'utf8')),
  );
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('falcon:test-apply-migrations'))`;
    for (const file of files) await tx.unsafe(file);
  });
}

export async function createAdminPostgres(): Promise<{
  prisma: FalconPrismaClient;
  sql: Sql;
  databaseUrl: string;
  cleanup: () => Promise<void>;
}> {
  const directUrl = process.env.FALCON_POSTGRES_URL;
  const container = directUrl
    ? null
    : await new PostgreSqlContainer('postgres:17.5-alpine3.21').start();
  const baseUrl = directUrl ?? container!.getConnectionUri();
  const schema = directUrl ? `falcon_admin_${randomUUID().replaceAll('-', '')}` : null;
  const admin = schema ? postgres(baseUrl, { max: 1 }) : null;
  if (schema) await admin!.unsafe(`CREATE SCHEMA "${schema}"`);
  const separator = baseUrl.includes('?') ? '&' : '?';
  const url = schema
    ? `${baseUrl}${separator}options=${encodeURIComponent(`-c search_path=${schema}`)}`
    : baseUrl;
  const prisma = createPrismaClient(url, schema === null ? undefined : { schema });
  const sql = postgres(url, { max: 2 });
  return {
    prisma,
    sql,
    databaseUrl: url,
    cleanup: async () => {
      await prisma.$disconnect();
      await sql.end();
      if (schema) await admin!.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin?.end();
      await container?.stop();
    },
  };
}
