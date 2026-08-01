import { existsSync } from 'node:fs';

import { createPrismaClient, type FalconPrismaClient } from '@falcon/database';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

export const shouldRunAdminPostgres =
  process.env.FALCON_POSTGRES_URL !== undefined ||
  process.env.DOCKER_HOST !== undefined ||
  existsSync('/var/run/docker.sock');

export async function createAdminPostgres(): Promise<{
  prisma: FalconPrismaClient;
  cleanup: () => Promise<void>;
}> {
  const container = process.env.FALCON_POSTGRES_URL
    ? null
    : await new PostgreSqlContainer('postgres:17.5-alpine3.21').start();
  const url = process.env.FALCON_POSTGRES_URL ?? container!.getConnectionUri();
  const prisma = createPrismaClient(url);
  return {
    prisma,
    cleanup: async () => {
      await prisma.$disconnect();
      await container?.stop();
    },
  };
}
