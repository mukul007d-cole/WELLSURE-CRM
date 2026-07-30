import type { UserSnapshot } from '@falcon/permission-engine';

import type { AuthConfig } from './config.js';
import { parseCookie } from './cookies.js';
import { validateSession, type SessionRecord, type SessionRepository } from './session.js';

export interface AuthenticatedContext {
  user: UserSnapshot;
  session: SessionRecord;
}

export async function authenticateCookie(input: {
  repository: SessionRepository;
  config: AuthConfig;
  cookieHeader: string | undefined;
  now?: Date | undefined;
}): Promise<AuthenticatedContext | null> {
  const token = parseCookie(input.cookieHeader, input.config.sessionCookieName);
  return validateSession({ repository: input.repository, token, now: input.now });
}
