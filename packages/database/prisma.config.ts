import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

dotenv.config({ path: '../../.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Client generation does not connect. Runtime/migration commands still receive DATABASE_URL.
    url: process.env.DATABASE_URL ?? 'postgresql://generate:generate@localhost:5432/generate',
  },
});
