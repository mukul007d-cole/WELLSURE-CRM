import { createPrismaClient, type FalconPrismaClient } from '@falcon/database';

import { defaultAuthConfig, type AuthConfig } from './auth/config.js';
import type { EmailSender } from './auth/password-reset.js';
import { parseEnv, type ApiEnv } from './env.js';

export interface ApiRuntime {
  env: ApiEnv;
  prisma: FalconPrismaClient;
  emailSender: EmailSender;
  authConfig: AuthConfig;
}

export function createRuntime(envInput: NodeJS.ProcessEnv): ApiRuntime {
  const env = parseEnv(envInput);
  const emailSender: EmailSender = {
    sendPasswordReset() {
      return Promise.reject(new Error('Password reset email delivery is not configured'));
    },
  };

  return {
    env,
    prisma: createPrismaClient(env.databaseUrl),
    emailSender,
    authConfig: { ...defaultAuthConfig, secureCookies: env.sessionCookieSecure },
  };
}
