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
    css: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
