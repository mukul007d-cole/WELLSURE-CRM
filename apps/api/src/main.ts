import { createPrismaClient } from '@falcon/database';

import { defaultAuthConfig } from './auth/config.js';
import { PrismaAuthRepository } from './auth/prisma-auth-repository.js';
import { PrismaConfigurationRepository } from './configuration/prisma-configuration-repository.js';
import { parseEnv } from './env.js';
import { buildServer } from './http/build-server.js';
import { PrismaLeadRepository } from './leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from './permissions/prisma-permission-repository.js';

const env = parseEnv(process.env);
const prisma = createPrismaClient(env.databaseUrl);
const authRepository = new PrismaAuthRepository(prisma);
const server = buildServer({
  authRepository,
  audit: authRepository,
  emailSender: {
    sendPasswordReset() {
      return Promise.reject(new Error('Password reset email delivery is not configured'));
    },
  },
  permissionRepository: new PrismaPermissionRepository(prisma as never),
  leadRepository: new PrismaLeadRepository(prisma as never),
  configurationRepository: new PrismaConfigurationRepository(prisma),
  authConfig: { ...defaultAuthConfig, secureCookies: env.sessionCookieSecure },
  corsOrigins: env.corsOrigins,
  logLevel: env.logLevel,
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  server.log.info({ signal }, 'graceful shutdown started');
  try {
    await server.close();
    await prisma.$disconnect();
    process.exitCode = 0;
  } catch (error) {
    server.log.error({ err: error }, 'graceful shutdown failed');
    process.exitCode = 1;
  }
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await server.listen({ host: '0.0.0.0', port: env.httpPort });
} catch (error) {
  server.log.error({ err: error }, 'API startup failed');
  await prisma.$disconnect();
  process.exitCode = 1;
}
