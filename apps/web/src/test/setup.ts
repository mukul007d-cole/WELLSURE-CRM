import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setupServer } from 'msw/node';

import { handlers } from '../mocks/handlers';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// globals: false in vitest.config.ts means Testing Library can't
// auto-detect afterEach to clean up the DOM between tests; wire it
// explicitly so unmounted component trees don't leak across test cases.
afterEach(() => {
  cleanup();
});
