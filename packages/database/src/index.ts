import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/client.js';

export const databaseSchemaPath = 'packages/database/prisma/schema.prisma' as const;

/** Construct (but do not eagerly connect) the process-owned database client. */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

export type FalconPrismaClient = PrismaClient;
