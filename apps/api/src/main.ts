import { PrismaAdminRepository } from './admin/prisma-admin-repository.js';
import { PrismaAttachmentRepository } from './attachments/prisma-attachment-repository.js';
import { S3AttachmentStorage } from './attachments/s3-storage.js';
import { AttachmentService } from './attachments/service.js';
import { PrismaAuthRepository } from './auth/prisma-auth-repository.js';
import { PrismaConfigurationRepository } from './configuration/prisma-configuration-repository.js';
import { PurgeService } from './configuration/purge-service.js';
import { PrismaExportRepository } from './export/prisma-export-repository.js';
import { buildServer } from './http/build-server.js';
import { PrismaImportRepository, visibleLeadIds } from './import/prisma-import-repository.js';
import { ImportService } from './import/service.js';
import { PrismaLeadRepository } from './leads/prisma-lead-repository.js';
import { LeadSharingService } from './leads/sharing.js';
import { NotificationService } from './notifications/service.js';
import { CampaignTriggerService } from './campaigns/trigger-service.js';
import { StatusRoutingService } from './routing/service.js';
import { PrismaPermissionRepository } from './permissions/prisma-permission-repository.js';
import { createRuntime } from './runtime.js';

const { env, prisma, emailSender, authConfig } = createRuntime(process.env);
const authRepository = new PrismaAuthRepository(prisma);
const notificationService = new NotificationService(prisma);
const campaignTriggerService = new CampaignTriggerService(prisma);
// The third consumer of the shared trigger detection (ADR-0015). Each
// transaction rebuilds it against its own client; this instance only tells the
// repository that routing is wired at all.
const statusRoutingService = new StatusRoutingService(prisma);
// Only when a bucket is configured. Absent it the locker routes answer 503
// rather than the API refusing to boot.
const attachmentService = env.storage
  ? new AttachmentService(
      new PrismaAttachmentRepository(prisma),
      new S3AttachmentStorage(env.storage),
    )
  : undefined;
const leadRepository = new PrismaLeadRepository(
  prisma as never,
  notificationService,
  campaignTriggerService,
  statusRoutingService,
);
/*
 * Import runs the ordinary creation path per row, so it borrows the very
 * repository the single-lead route uses — rebound to its own transaction. An
 * imported lead therefore reaches Notifications, Campaigns and Routing exactly
 * as a hand-created one does, because it is the same object doing the work.
 */
const importService = new ImportService(
  prisma,
  new PrismaImportRepository(prisma),
  leadRepository,
  visibleLeadIds,
);
const server = buildServer({
  authRepository,
  audit: authRepository,
  emailSender,
  permissionRepository: new PrismaPermissionRepository(prisma as never),
  leadRepository,
  importService,
  exportRepository: new PrismaExportRepository(prisma),
  configurationRepository: new PrismaConfigurationRepository(prisma),
  purgeService: new PurgeService(prisma),
  adminRepository: new PrismaAdminRepository(prisma),
  leadSharingService: new LeadSharingService(prisma, notificationService),
  notificationService,
  prisma,
  ...(attachmentService ? { attachmentService } : {}),
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
