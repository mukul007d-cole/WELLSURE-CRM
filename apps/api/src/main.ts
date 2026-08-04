import { PrismaAdminRepository } from './admin/prisma-admin-repository.js';
import { PrismaAuthRepository } from './auth/prisma-auth-repository.js';
import { PrismaConfigurationRepository } from './configuration/prisma-configuration-repository.js';
import { buildServer } from './http/build-server.js';
import { PrismaLeadRepository } from './leads/prisma-lead-repository.js';
import { LeadSharingService } from './leads/sharing.js';
import { NotificationService } from './notifications/service.js';
import { PrismaPermissionRepository } from './permissions/prisma-permission-repository.js';
import { createRuntime } from './runtime.js';

const { env, prisma, emailSender, authConfig } = createRuntime(process.env);
const authRepository = new PrismaAuthRepository(prisma);
const notificationService = new NotificationService(prisma);
const server = buildServer({
  authRepository,
  audit: authRepository,
  emailSender,
  permissionRepository: new PrismaPermissionRepository(prisma as never),
  leadRepository: new PrismaLeadRepository(prisma as never, notificationService),
  configurationRepository: new PrismaConfigurationRepository(prisma),
  adminRepository: new PrismaAdminRepository(prisma),
  leadSharingService: new LeadSharingService(prisma, notificationService),
  notificationService,
  authConfig,
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
