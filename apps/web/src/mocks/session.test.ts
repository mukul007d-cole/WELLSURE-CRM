import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression coverage for the "refreshing the page logs you out" bug.
 * The original implementation kept token -> userId in a plain module-level
 * Map, which is JS heap state — a hard page reload creates a fresh module
 * instance and silently wipes it, even though the session cookie itself
 * survives the reload. The fix moved the mapping into sessionStorage, which
 * persists independently of module state. vi.resetModules() + a dynamic
 * re-import simulates exactly that "fresh module instance" a real reload
 * produces, without needing a real browser navigation.
 */
describe('mock session persistence across a simulated reload', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  afterEach(() => {
    sessionStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('resolves the same user from a freshly-loaded module instance', async () => {
    vi.resetModules();
    const firstLoad = await import('./session');
    const token = firstLoad.createSession('user-admin');
    document.cookie = firstLoad.setCookieHeader(token);
    expect(firstLoad.resolveUserId()).toBe('user-admin');

    // Simulate a hard page reload: every module gets re-evaluated from
    // scratch, so any plain in-memory Map would now be empty again.
    vi.resetModules();
    const afterReload = await import('./session');

    expect(afterReload.resolveUserId()).toBe('user-admin');
  });

  it('does not resolve a user once the session cookie is cleared, even though sessionStorage still has the token', async () => {
    vi.resetModules();
    const mod = await import('./session');
    const token = mod.createSession('user-rep');
    document.cookie = mod.setCookieHeader(token);
    expect(mod.resolveUserId()).toBe('user-rep');

    document.cookie = mod.clearCookieHeader();
    expect(mod.resolveUserId()).toBeUndefined();
  });
});
