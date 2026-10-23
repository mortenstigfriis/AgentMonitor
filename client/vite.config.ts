import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: mode === 'mission-control' ? {
    rollupOptions: { input: resolve(clientRoot, 'mission-control.html') },
  } : undefined,
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3456',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3456',
        ws: true,
      },
    },
  },
}));
