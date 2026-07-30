import type { AuthConfig } from './config.js';

export function serializeSessionCookie(value: string, config: AuthConfig, expiresAt: Date): string {
  const parts = [
    `${config.sessionCookieName}=${encodeURIComponent(value)}`,
    'HttpOnly',
    `SameSite=${capitalize(config.sameSite)}`,
    'Path=/',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (config.secureCookies) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function serializeClearedSessionCookie(config: AuthConfig): string {
  return `${config.sessionCookieName}=; HttpOnly; SameSite=${capitalize(config.sameSite)}; Path=/; Max-Age=0${config.secureCookies ? '; Secure' : ''}`;
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) {
    return null;
  }
  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) {
      return decodeURIComponent(rawValue.join('='));
    }
  }
  return null;
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}
