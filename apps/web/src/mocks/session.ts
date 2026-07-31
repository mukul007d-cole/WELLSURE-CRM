export const SESSION_COOKIE_NAME = 'falcon_session';

const STORAGE_KEY = 'falcon_mock_sessions';

/**
 * A plain in-memory Map would reset on every hard reload (module state
 * doesn't survive navigation, unlike a real server process), silently
 * logging the demo user out on refresh. sessionStorage survives reloads
 * within the tab, which is what a real persisted session would feel like.
 */
function readSessions(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function writeSessions(sessions: Record<string, string>): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function createSession(userId: string): string {
  const token = `mock-${userId}-${Math.random().toString(36).slice(2)}`;
  const sessions = readSessions();
  sessions[token] = userId;
  writeSessions(sessions);
  return token;
}

export function destroySession(token: string | undefined): void {
  if (!token) return;
  const sessions = readSessions();
  delete sessions[token];
  writeSessions(sessions);
}

/**
 * MSW handlers run in the page's JS context, and browsers strip the Cookie
 * header from any script-visible Request (a Fetch spec restriction, not an
 * MSW bug) — so request.headers.get('cookie') is always empty here. Reading
 * document.cookie directly works because the mock session cookie isn't
 * HttpOnly. A real server-set HttpOnly cookie doesn't have this problem;
 * this is purely a dev-mock workaround.
 */
export function currentSessionToken(): string | undefined {
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  return match?.slice(SESSION_COOKIE_NAME.length + 1);
}

export function resolveUserId(): string | undefined {
  const token = currentSessionToken();
  return token ? readSessions()[token] : undefined;
}

export function setCookieHeader(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; SameSite=Lax`;
}

export function clearCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0`;
}
