import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  define: {
    'import.meta.env.VITE_FALCON_ORGANIZATION_ID': JSON.stringify('org-wellsure'),
  },
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    /**
     * Must stay above Testing Library's asyncUtilTimeout (see src/test/setup.ts).
     * If a findBy can outlive the test, a missing element is reported as a bare
     * "test timed out" instead of naming what it was looking for.
     */
    testTimeout: 20_000,
    css: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
