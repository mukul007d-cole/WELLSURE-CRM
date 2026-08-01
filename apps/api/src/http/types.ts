import type { PermissionRepository } from '@falcon/permission-engine';
import type { FastifyRequest } from 'fastify';

import type { SecurityAuditWriter } from '../auth/audit.js';
import type { AuthConfig } from '../auth/config.js';
import type { AuthenticatedContext } from '../auth/middleware.js';
import type { EmailSender, PasswordResetRepository } from '../auth/password-reset.js';
import type { LoginRepository } from '../auth/login.js';
import type { SessionRepository } from '../auth/session.js';
import type { ConfigurationRepository } from '../configuration/service.js';
import type { LeadRepository } from '../leads/service.js';
import type { SellerReadRepository } from '../routes/leads.js';

export interface ServerDependencies {
  authRepository: LoginRepository & SessionRepository & PasswordResetRepository;
  audit: SecurityAuditWriter;
  emailSender: EmailSender;
  permissionRepository: PermissionRepository;
  leadRepository: LeadRepository & SellerReadRepository;
  configurationRepository: ConfigurationRepository;
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
