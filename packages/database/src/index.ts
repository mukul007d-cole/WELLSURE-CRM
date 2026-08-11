import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/client.js';

export const databaseSchemaPath = 'packages/database/prisma/schema.prisma' as const;

/** Construct (but do not eagerly connect) the process-owned database client. */
export function createPrismaClient(
  databaseUrl: string,
  options?: { schema?: string },
): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: databaseUrl },
      options?.schema === undefined ? undefined : { schema: options.schema },
    ),
  });
}

export type FalconPrismaClient = PrismaClient;

/** Re-exported for callers that need JSON null vs column null (`Prisma.DbNull`). */
export { Prisma } from './generated/client.js';
