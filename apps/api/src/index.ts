/** Foundation boundary for the Falcon api workspace. */
export const workspaceName = '@falcon/api' as const;

export { defaultAuthConfig } from './auth/config.js';
export { hashPassword, normalizeEmail, verifyPassword } from './auth/password.js';
export { issueSession, revokeSession, validateSession } from './auth/session.js';
export { login } from './auth/login.js';
export { completePasswordReset, requestPasswordReset } from './auth/password-reset.js';
export { authenticateCookie } from './auth/middleware.js';
export { PrismaAuthRepository } from './auth/prisma-auth-repository.js';
export { PrismaPermissionRepository } from './permissions/prisma-permission-repository.js';
export { getLeadById } from './routes/leads.js';
export type * from './auth/audit.js';
export type * from './auth/config.js';
export type * from './auth/login.js';
export type * from './auth/password-reset.js';
export type * from './auth/session.js';
export type * from './auth/middleware.js';
export type * from './routes/leads.js';

export * from './routes/configuration.js';
export * from './configuration/service.js';
export * from './configuration/errors.js';
export * from './configuration/validation.js';
