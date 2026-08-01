import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { createPrismaClient, type FalconPrismaClient } from '@falcon/database';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';

export const shouldRunAdminPostgres =
  process.env.FALCON_POSTGRES_URL !== undefined ||
  process.env.DOCKER_HOST !== undefined ||
  existsSync('/var/run/docker.sock');

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
