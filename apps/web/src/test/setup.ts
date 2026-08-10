import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { setupServer } from 'msw/node';

import { handlers, resetAdminMockState } from '../mocks/handlers';

/**
 * These are integration-style tests: they render real pages against MSW, and
 * several mock handlers deliberately delay to exercise loading states. Testing
 * Library's 1s default for findBy and waitFor leaves almost no headroom for that
 * once CI runs the suite's workers in parallel on shared cores, which showed up
 * as an intermittent failure with no code change behind it.
 *
 * A longer ceiling doesn't slow a passing test — the wait resolves as soon as
 * the assertion does — it only stops a slow machine being reported as a broken
 * one. Genuine hangs still fail, just later.
 */
configure({ asyncUtilTimeout: 5_000 });

export const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetAdminMockState();
});
afterAll(() => server.close());

// globals: false in vitest.config.ts means Testing Library can't
// auto-detect afterEach to clean up the DOM between tests; wire it
// explicitly so unmounted component trees don't leak across test cases.
afterEach(() => {
  cleanup();
});
