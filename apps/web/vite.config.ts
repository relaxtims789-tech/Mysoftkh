import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :3200; Vite proxies to it so the app and API share one origin (cookies, no CORS).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': 'http://localhost:3200', '/uploads': 'http://localhost:3200' },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
