export interface AuthConfig {
  sessionCookieName: string;
  sessionTtlMs: number;
  resetTokenTtlMs: number;
  lockoutMaxAttempts: number;
  lockoutWindowMs: number;
  lockoutDurationMs: number;
  secureCookies: boolean;
  sameSite: 'strict' | 'lax' | 'none';
}

export const defaultAuthConfig: AuthConfig = {
  sessionCookieName: 'falcon_session',
  sessionTtlMs: 8 * 60 * 60 * 1000,
  resetTokenTtlMs: 30 * 60 * 1000,
  lockoutMaxAttempts: 5,
  lockoutWindowMs: 15 * 60 * 1000,
  lockoutDurationMs: 15 * 60 * 1000,
  secureCookies: true,
  sameSite: 'lax',
};
