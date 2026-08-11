import { createPrismaClient, type FalconPrismaClient } from '@falcon/database';

import { defaultAuthConfig, type AuthConfig } from './auth/config.js';
import { createEmailSender } from './auth/email-sender.js';
import type { CampaignEmailSender, EmailSender } from './auth/password-reset.js';
import { parseEnv, type ApiEnv } from './env.js';

export interface ApiRuntime {
  env: ApiEnv;
  prisma: FalconPrismaClient;
  emailSender: EmailSender & CampaignEmailSender;
  authConfig: AuthConfig;
}

export function createRuntime(envInput: NodeJS.ProcessEnv): ApiRuntime {
  const env = parseEnv(envInput);
  const emailSender = createEmailSender({ transport: env.emailTransport, httpPort: env.httpPort });

  return {
    env,
    prisma: createPrismaClient(env.databaseUrl),
    emailSender,
    authConfig: { ...defaultAuthConfig, secureCookies: env.sessionCookieSecure },
  };
}
