import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  /*
   * Vite reads `.env` from its own root — `apps/web` — but this monorepo keeps
   * one `.env` at the top level, which is where `.env.example` tells people to
   * put `VITE_FALCON_ORGANIZATION_ID`. Without this, that variable is simply
   * absent: `vite build` succeeds and ships a bundle whose first act in the
   * browser is to throw "VITE_FALCON_ORGANIZATION_ID is required", which reads
   * as a blank page. A build-time failure would be better than a runtime one;
   * pointing Vite at the file people are told to edit is better than both.
   */
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
