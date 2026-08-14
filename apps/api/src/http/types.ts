import type { PermissionRepository } from '@falcon/permission-engine';
import type { FastifyRequest } from 'fastify';

import type { SecurityAuditWriter } from '../auth/audit.js';
import type { AuthConfig } from '../auth/config.js';
import type { AuthenticatedContext } from '../auth/middleware.js';
import type { FalconPrismaClient } from '@falcon/database';
import type {
  CampaignEmailSender,
  EmailSender,
  PasswordResetRepository,
} from '../auth/password-reset.js';
import type { LoginRepository } from '../auth/login.js';
import type { SessionRepository } from '../auth/session.js';
import type { ConfigurationRepository } from '../configuration/service.js';
import type { AdminRepository } from '../admin/repository.js';
import type { LeadRepository } from '../leads/service.js';
import type { LeadActivityReadRepository, SellerReadRepository } from '../routes/leads.js';
import type { LeadSharingService } from '../leads/sharing.js';
import type { NotificationService } from '../notifications/service.js';
import type { AttachmentService } from '../attachments/service.js';
import type { ImportService } from '../import/service.js';
import type { ExportAuditWriter, ExportFieldRepository } from '../routes/export.js';

export interface ServerDependencies {
  authRepository: LoginRepository & SessionRepository & PasswordResetRepository;
  audit: SecurityAuditWriter;
  emailSender: EmailSender & CampaignEmailSender;
  /**
   * Present when the deployment has a real database client. Campaign routes are
   * registered only then; everything else works through its repository.
   */
  prisma?: FalconPrismaClient;
  permissionRepository: PermissionRepository;
  leadRepository: LeadRepository & SellerReadRepository & LeadActivityReadRepository;
  configurationRepository: ConfigurationRepository;
  adminRepository?: AdminRepository;
  leadSharingService?: LeadSharingService;
  notificationService?: NotificationService;
  /** Absent when object storage isn't configured; the locker degrades to 503. */
  attachmentService?: AttachmentService;
  /**
   * Bulk import. Needs a real database client for its own transaction — the run
   * holds one open across the whole file — so a deployment wired without one has
   * no import routes rather than half-working ones, exactly as campaigns do.
   */
  importService?: ImportService;
  /** Supplies the export's Field columns and writes its audit row. */
  exportRepository?: ExportFieldRepository & ExportAuditWriter;
  authConfig: AuthConfig;
  corsOrigins: readonly string[];
  logLevel?: string;
  authRateLimit?: { max: number; timeWindow: number };
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthenticatedContext;
  }
}

export function clientAddress(request: FastifyRequest): {
  ipAddress: string;
  userAgent: string | null;
} {
  const agent = request.headers['user-agent'];
  return { ipAddress: request.ip, userAgent: agent ?? null };
}
