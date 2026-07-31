import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// globals: false in vitest.config.ts means Testing Library can't
// auto-detect afterEach to clean up the DOM between tests; wire it
// explicitly so unmounted component trees don't leak across test cases.
afterEach(() => {
  cleanup();
});
