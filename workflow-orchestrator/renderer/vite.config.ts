import {resolve} from 'node:path';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  root: resolve(import.meta.dirname),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, '../src/shared'),
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, '../dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    fs: {
      allow: [resolve(import.meta.dirname, '..'), resolve(import.meta.dirname, '../../requirements-engineering')],
    },
    host: '127.0.0.1',
    port: 5178,
    strictPort: true,
  },
});
