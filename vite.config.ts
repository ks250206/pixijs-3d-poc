import { defineConfig } from 'vite-plus';

export default defineConfig({
  base: '/pixijs-3d-poc/',
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: '0.0.0.0', port: 4173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1400,
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
