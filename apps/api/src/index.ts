/** Foundation boundary for the Falcon api workspace. */
export const workspaceName = '@falcon/api' as const;

export { defaultAuthConfig } from './auth/config.js';
export { hashPassword, normalizeEmail, verifyPassword } from './auth/password.js';
export { issueSession, revokeSession, validateSession } from './auth/session.js';
export { login } from './auth/login.js';
export { completePasswordReset, requestPasswordReset } from './auth/password-reset.js';
export { authenticateCookie } from './auth/middleware.js';
export {
  completePasswordResetRoute,
  loginRoute,
  logoutRoute,
  requestPasswordResetRoute,
} from './routes/auth.js';
export { PrismaAuthRepository } from './auth/prisma-auth-repository.js';
export { PrismaPermissionRepository } from './permissions/prisma-permission-repository.js';
export { createLead, editLead, getLeadById, getSeller360, listSellers } from './routes/leads.js';
export type * from './auth/audit.js';
export type * from './auth/config.js';
export type * from './auth/login.js';
export type * from './auth/password-reset.js';
export type * from './auth/session.js';
export type * from './auth/middleware.js';
export type * from './routes/leads.js';
export * from './leads/service.js';
export * from './leads/errors.js';
export * from './leads/validation.js';
export { PrismaLeadRepository } from './leads/prisma-lead-repository.js';
export { LeadSharingService, shareCapabilities } from './leads/sharing.js';
export {
  NotificationService,
  notificationTriggers,
  recipientResolvers,
} from './notifications/service.js';
export { seedExampleNotificationRules } from './notifications/seed-example-rules.js';
export type { PrismaLeadClient } from './leads/prisma-lead-repository.js';

export * from './routes/configuration.js';
export * from './configuration/service.js';
export * from './configuration/errors.js';
export * from './configuration/validation.js';
export { PrismaConfigurationRepository } from './configuration/prisma-configuration-repository.js';
